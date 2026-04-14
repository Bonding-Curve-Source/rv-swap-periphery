/**
 * Deploy RaviV2Router02(factory, WETH).
 * Cần: yarn compile, Factory + WETH đã có trên chain.
 */
import * as path from 'path'
import * as fs from 'fs'
import { ethers } from 'ethers'
import { config } from 'dotenv'
import { loadBytecode } from './utils'

config({ path: path.join(__dirname, '../.env') })

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL
  const pk = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY
  const factoryAddr = process.env.FACTORY_ADDRESS
  const wethAddr = process.env.WETH_ADDRESS
  if (!rpcUrl || !pk || !factoryAddr || !wethAddr) {
    throw new Error('Cần RPC_URL, PRIVATE_KEY (hoặc DEPLOYER_PRIVATE_KEY), FACTORY_ADDRESS, WETH_ADDRESS trong .env')
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
  const wallet = new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk, provider)

  const artifactPath = path.join(__dirname, '../build/RaviV2Router02.json')
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const bytecode = loadBytecode(artifact)

  const c = new ethers.ContractFactory(artifact.abi, bytecode, wallet)
  console.log('Deploy RaviV2Router02(factory, WETH)')
  console.log('  factory:', factoryAddr)
  console.log('  WETH:   ', wethAddr)
  const deployed = await c.deploy(factoryAddr, wethAddr)
  console.log('Tx:', deployed.deployTransaction.hash)
  await deployed.deployTransaction.wait()
  console.log('ROUTER02_ADDRESS=', deployed.address)
}

main().catch((e: Error) => {
  console.error(e)
  process.exit(1)
})
