import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber } from 'ethers'

export const signPermit = async (
  chainId: number,
  contractAddress: string,
  signer: SignerWithAddress,
  name: string,
  owner: string,
  spender: string,
  value: number,
  nonce: BigNumber,
  deadline: number
) => {
  // "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
  const domain = {
    name,
    version: '1',
    chainId,
    verifyingContract: contractAddress,
  }

  // keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
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
};

export default signPermit;
