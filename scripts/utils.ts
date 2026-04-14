import { ethers } from 'ethers'

export interface ArtifactLike {
  bytecode?: string
  evm?: { bytecode?: { object?: string } }
}

export function loadBytecode(artifact: ArtifactLike): string {
  if (typeof artifact.bytecode === 'string' && artifact.bytecode.length > 2) {
    return artifact.bytecode.startsWith('0x') ? artifact.bytecode : '0x' + artifact.bytecode
  }
  const obj = artifact.evm?.bytecode?.object
  if (obj && obj.length > 2) {
    return obj.startsWith('0x') ? obj : '0x' + obj
  }
  throw new Error('Không tìm thấy bytecode trong artifact. Chạy: yarn compile')
}

export function initCodeHashFromBytecode(bytecodeHex: string): string {
  return ethers.utils.keccak256(bytecodeHex)
}

/** CREATE2 pair address — khớp `RaviV2Library.pairFor` / UniswapV2Library. */
export function computePairAddress(
  factory: string,
  tokenA: string,
  tokenB: string,
  initCodeHash: string
): string {
  const f = ethers.utils.getAddress(factory)
  const a = ethers.utils.getAddress(tokenA)
  const b = ethers.utils.getAddress(tokenB)
  const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
  const salt = ethers.utils.solidityKeccak256(['address', 'address'], [t0, t1])
  const data = ethers.utils.concat([
    ethers.utils.arrayify('0xff'),
    ethers.utils.arrayify(f),
    ethers.utils.arrayify(salt),
    ethers.utils.arrayify(initCodeHash),
  ])
  const h = ethers.utils.keccak256(data)
  return ethers.utils.getAddress(ethers.utils.hexDataSlice(h, 12))
}
