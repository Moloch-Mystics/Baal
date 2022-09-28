import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export default async function signVote(
  chainId: number,
  contractAddress: string,
  signer: SignerWithAddress,
  name: string,
  expiry: number,
  proposalId: number,
  support: boolean

) {
  const domain = {
    name: 'Vote',
    version: '4',
    chainId,
    verifyingContract: contractAddress,
  }

  const types = {
    Vote: [
      { name: 'name', type: 'string' },
      { name: 'voter', type: 'address' },
      { name: 'expiry', type: 'uint256' },
      { name: 'proposalId', type: 'uint32' },
      { name: 'support', type: 'bool' },
    ],
  }

  const values = {
    name,
    voter: signer.address,
    expiry,
    proposalId,
    support
  }

  const sig = await signer._signTypedData(domain, types, values)

  return sig
}
