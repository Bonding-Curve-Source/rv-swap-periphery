/**
 * Thêm thanh khoản cặp native (ETH/BNB/…) + TOKEN qua RaviV2Router02.addLiquidityETH.
 * Router nhận native, wrap WETH nội bộ — không dùng addLiquidity với WETH ERC20.
 *
 * Mặc định: 3 native + 1800 TOKEN (tỉ lệ 1 native = 600 TOKEN).
 *
 * .env: RPC_URL, PRIVATE_KEY, ROUTER_ADDRESS, TOKEN_ADDRESS
 * Tuỳ chọn: AMOUNT_NATIVE | AMOUNT_ETH | AMOUNT_WETH, AMOUNT_TOKEN, NATIVE_DECIMALS, SLIPPAGE_BPS
 * PAIR_ARTIFACT_PATH: mặc định ../v2-core/build/RaviV2Pair.json (để kiểm tra INIT_CODE_HASH)
 */
import * as path from 'path'
import * as fs from 'fs'
import { ethers, BigNumber } from 'ethers'
import { config } from 'dotenv'
import { loadBytecode, initCodeHashFromBytecode, computePairAddress } from './utils'

config({ path: path.join(__dirname, '../.env') })

/** Hash pair init code Uniswap V2 chuẩn (factory cũ / chưa rebrand RAVI). */
const UNISWAP_V2_STANDARD_INIT =
  '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f'

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

const FACTORY_ABI = ['function getPair(address,address) view returns (address)']

const ROUTER_MIN_ABI = [
  'function factory() view returns (address)',
  'function WETH() view returns (address)',
  'function addLiquidityETH(address,uint,uint,uint,address,uint) payable returns (uint,uint,uint)',
]

function applySlippage(amount: BigNumber, slippageBps: number): BigNumber {
  return amount.mul(10000 - slippageBps).div(10000)
}

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL
  const pk = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY
  const routerAddr = process.env.ROUTER_ADDRESS
  const tokenAddr = process.env.TOKEN_ADDRESS

  if (!rpcUrl || !pk || !routerAddr || !tokenAddr) {
    throw new Error(
      'Thiếu RPC_URL, PRIVATE_KEY (hoặc DEPLOYER_PRIVATE_KEY), ROUTER_ADDRESS, TOKEN_ADDRESS trong .env'
    )
  }

  const amountNativeHuman =
    process.env.AMOUNT_NATIVE ?? process.env.AMOUNT_ETH ?? process.env.AMOUNT_WETH ?? '3'
  const amountTokenHuman = process.env.AMOUNT_TOKEN ?? '1800'
  const nativeDecimals = Number(process.env.NATIVE_DECIMALS ?? '18')
  const slippageBps = Number(process.env.SLIPPAGE_BPS ?? '100')
  if (slippageBps < 0 || slippageBps >= 10000) {
    throw new Error('SLIPPAGE_BPS phải trong [0, 10000)')
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
  const wallet = new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk, provider)

  const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet)
  const decToken = await token.decimals()

  const amountNative = ethers.utils.parseUnits(amountNativeHuman, nativeDecimals)
  const amountToken = ethers.utils.parseUnits(amountTokenHuman, decToken)

  const amountTokenMin = applySlippage(amountToken, slippageBps)
  const amountETHMin = applySlippage(amountNative, slippageBps)

  const [balNative, balToken] = await Promise.all([
    provider.getBalance(wallet.address),
    token.balanceOf(wallet.address),
  ])
  if (balNative.lt(amountNative)) {
    throw new Error(
      `Không đủ native: cần ${amountNativeHuman} (wei theo NATIVE_DECIMALS), có ${ethers.utils.formatUnits(balNative, nativeDecimals)}`
    )
  }
  if (balToken.lt(amountToken)) {
    throw new Error(`Không đủ TOKEN: cần ${amountTokenHuman}, có ${ethers.utils.formatUnits(balToken, decToken)}`)
  }

  const artifactPath = path.join(__dirname, '../build/RaviV2Router02.json')
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const router = new ethers.Contract(routerAddr, artifact.abi, wallet)
  const routerMini = new ethers.Contract(routerAddr, ROUTER_MIN_ABI, provider)

  const onChainFactory = await routerMini.factory()
  const onChainWeth = await routerMini.WETH()
  if (process.env.FACTORY_ADDRESS && onChainFactory.toLowerCase() !== process.env.FACTORY_ADDRESS.toLowerCase()) {
    console.warn(
      'Cảnh báo: ROUTER.factory() =',
      onChainFactory,
      'khác FACTORY_ADDRESS trong .env:',
      process.env.FACTORY_ADDRESS
    )
  }
  if (process.env.WETH_ADDRESS && onChainWeth.toLowerCase() !== process.env.WETH_ADDRESS.toLowerCase()) {
    console.warn(
      'Cảnh báo: ROUTER.WETH() =',
      onChainWeth,
      'khác WETH_ADDRESS trong .env:',
      process.env.WETH_ADDRESS
    )
  }

  const pairArtifactPath =
    process.env.PAIR_ARTIFACT_PATH ||
    path.join(__dirname, '../../v2-core/build/RaviV2Pair.json')
  let initFromArtifact: string | undefined
  if (fs.existsSync(pairArtifactPath)) {
    const pairRaw = JSON.parse(fs.readFileSync(pairArtifactPath, 'utf8'))
    const bc = loadBytecode(pairRaw)
    initFromArtifact = initCodeHashFromBytecode(bc)
  }

  const factoryC = new ethers.Contract(onChainFactory, FACTORY_ABI, provider)
  const pairExisting = await factoryC.getPair(tokenAddr, onChainWeth)

  if (initFromArtifact) {
    const pairRaviLib = computePairAddress(onChainFactory, tokenAddr, onChainWeth, initFromArtifact)
    const pairStd = computePairAddress(onChainFactory, tokenAddr, onChainWeth, UNISWAP_V2_STANDARD_INIT)
    console.log('Kiểm tra CREATE2 pair (router dùng hash trong RaviV2Library khi đọc reserves):')
    console.log('  INIT từ artifact', pairArtifactPath, '→', initFromArtifact)
    console.log('  pair (hash artifact):', pairRaviLib)
    console.log('  pair (hash Uniswap chuẩn):', pairStd)
    console.log('  factory.getPair(token,WETH):', pairExisting)

    if (pairExisting !== ethers.constants.AddressZero) {
      const okRavi = pairExisting.toLowerCase() === pairRaviLib.toLowerCase()
      const okStd = pairExisting.toLowerCase() === pairStd.toLowerCase()
      if (!okRavi && !okStd) {
        throw new Error(
          'Địa chỉ pair on-chain không khớp CREATE2 với bất kỳ hash quen thuộc. Kiểm tra factory / bytecode pair đã deploy.'
        )
      }
      if (!okRavi && okStd) {
        throw new Error(
          [
            'Factory/pair trên chain dùng init code Uniswap V2 chuẩn (0x96e8ac42…),',
            'nhưng RaviV2Library trong router đang dùng hash từ artifact RaviV2Pair hiện tại.',
            '→ getReserves trong router trỏ sai pair, addLiquidityETH sẽ revert.',
            'Cách xử lý: biên dịch lại router với RaviV2Library có hex\'96e8ac42…\' HOẶC deploy lại factory/pair cùng bytecode với v2-core hiện tại.',
          ].join(' ')
        )
      }
      if (okRavi && !okStd) {
        console.log('  → Khớp hash RAVI (artifact); OK với library hiện tại.')
      }
    } else {
      console.log(
        '  (Chưa có pair — lần đầu add liquidity; factory sẽ createPair. Hash trong RaviV2Library phải trùng keccak256(creationCode) mà factory dùng.)'
      )
    }
  } else {
    console.warn(
      'Không tìm thấy artifact pair tại',
      pairArtifactPath,
      '— bỏ qua kiểm tra INIT_CODE_HASH. Đặt PAIR_ARTIFACT_PATH hoặc chạy yarn compile trong v2-core.'
    )
  }

  const maxUint = ethers.constants.MaxUint256
  const cur = await token.allowance(wallet.address, routerAddr)
  if (cur.lt(amountToken)) {
    console.log('approve TOKEN cho router…')
    const approveTx = await token.approve(routerAddr, maxUint)
    await approveTx.wait()
    console.log('  tx:', approveTx.hash)
  }

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20
  console.log('addLiquidityETH', {
    token: tokenAddr,
    amountTokenDesired: amountToken.toString(),
    amountTokenMin: amountTokenMin.toString(),
    amountETHMin: amountETHMin.toString(),
    value: amountNative.toString(),
    to: wallet.address,
    deadline,
  })

  try {
    await router.callStatic.addLiquidityETH(
      tokenAddr,
      amountToken,
      amountTokenMin,
      amountETHMin,
      wallet.address,
      deadline,
      { value: amountNative }
    )
  } catch (e) {
    const err = e as { error?: { data?: string }; data?: string; reason?: string }
    console.error('callStatic addLiquidityETH thất bại (cùng lỗi với estimateGas):', err?.reason || e)
    if (err?.error?.data) console.error('revert data:', err.error.data)
    if (err?.data) console.error('data:', err.data)
    throw new Error(
      'Giao dịch sẽ revert. Xem thông tin INIT_CODE_HASH / factory ở trên; hoặc tăng slippage (giảm SLIPPAGE_BPS), kiểm tra token (fee-on-transfer), và ROUTER đúng bản RaviV2Router02.'
    )
  }

  const gasOverrides: { gasLimit?: BigNumber } = {}
  if (process.env.GAS_LIMIT) {
    gasOverrides.gasLimit = BigNumber.from(process.env.GAS_LIMIT)
  }

  const tx = await router.addLiquidityETH(
    tokenAddr,
    amountToken,
    amountTokenMin,
    amountETHMin,
    wallet.address,
    deadline,
    { value: amountNative, ...gasOverrides }
  )
  console.log('addLiquidityETH tx:', tx.hash)
  const receipt = await tx.wait()
  console.log('đã xác nhận, block:', receipt.blockNumber)
}

main().catch((e: Error) => {
  console.error(e)
  process.exit(1)
})
