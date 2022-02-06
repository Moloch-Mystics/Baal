import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export default async function signPermit(
  chainId: number,
  contractAddress: string,
  signer: SignerWithAddress,
  name: string,
  owner: string,
  spender: string,
  value: string,
  nonce: string,
  deadline: string

) {
  const domain = {
    name,
    chainId,
    verifyingContract: contractAddress,
  }

  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint' },
      { name: 'nonce', type: 'uint' },
      { name: 'deadline', type: 'uint' },
    ],
  }

  const sig = await signer._signTypedData(domain, types, {
    owner,
    spender,
    value,
    nonce,
    deadline
  })

  return sig
}
