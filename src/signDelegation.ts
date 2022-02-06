import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export default async function signDelegation(
  chainId: number,
  contractAddress: string,
  signer: SignerWithAddress,
  name: string,
  delegatee: string,
  nonce: string,
  expiry: string
) {
  const domain = {
    name,
    chainId,
    verifyingContract: contractAddress,
  }

  const types = {
    Permit: [
      { name: 'delegatee', type: 'address' },
      { name: 'nonce', type: 'uint' },
      { name: 'expiry', type: 'uint' },
    ],
  }

  const sig = await signer._signTypedData(domain, types, {
    delegatee,
    nonce,
    expiry,
  })

  return sig
}
