import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export const signDelegation = async (
  chainId: number,
  contractAddress: string,
  signer: SignerWithAddress,
  name: string,
  delegatee: string,
  nonce: number,
  expiry: number
) => {
  const domain = {
    name: 'delegation',
    version: '4',
    chainId,
    verifyingContract: contractAddress,
  }

  const types = {
    Delegation: [
      { name: 'name', type: 'string' },
      { name: 'delegatee', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
  }

  const values = {
    name,
    delegatee,
    nonce,
    expiry,
  }

  const sig = await signer._signTypedData(domain, types, values)

  return sig
};

export default signDelegation;
