import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export const signVote = async (
  chainId: number,
  contractAddress: string,
  signer: SignerWithAddress,
  name: string,
  expiry: number,
  nonce: number,
  proposalId: number,
  support: boolean

) => {
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
      { name: 'nonce', type: 'uint256' },
      { name: 'proposalId', type: 'uint32' },
      { name: 'support', type: 'bool' },
    ],
  }

  const values = {
    name,
    voter: signer.address,
    expiry,
    nonce,
    proposalId,
    support
  }

  const sig = await signer._signTypedData(domain, types, values)

  return sig
};

export default signVote;
