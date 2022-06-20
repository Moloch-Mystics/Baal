import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export default async function signDelegation(
  chainId: number,
  contractAddress: string,
  signer: SignerWithAddress,
  name: string,
  delegatee: string,
  nonce: number,
  expiry: number
) {
  const domain = {
    name,
    chainId,
    verifyingContract: contractAddress,
  }

  const types = {
    Delegation: [
      { name: 'delegatee', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
  }

  const sig = await signer._signTypedData(domain, types, {
    delegatee,
    nonce,
    expiry,
  })

  return sig
}
