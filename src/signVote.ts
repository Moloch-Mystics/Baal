import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export default async function signVote(
  chainId: number,
  contractAddress: string,
  signer: SignerWithAddress,
  name: string,
  proposalId: number,
  support: boolean

) {
  const domain = {
    name,
    chainId,
    verifyingContract: contractAddress,
  }

  const types = {
    Vote: [
      { name: 'proposalId', type: 'uint32' },
      { name: 'support', type: 'bool' },
    ],
  }

  const sig = await signer._signTypedData(domain, types, {
    proposalId,
    support
  })

  return sig
}
