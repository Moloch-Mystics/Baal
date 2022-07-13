import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber } from 'ethers'

export default async function signPermit(
  chainId: number,
  contractAddress: string,
  signer: SignerWithAddress,
  name: string,
  owner: string,
  spender: string,
  value: number,
  nonce: BigNumber,
  deadline: number

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
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
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
