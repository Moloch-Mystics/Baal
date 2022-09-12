import { BigNumber } from '@ethersproject/bignumber'
import { ethers } from 'hardhat'
import { encodeMultiSend, MetaTransaction } from '@gnosis.pm/safe-contracts'
import { MultiSend } from './types'

export const encodeMultiAction = (multisend: MultiSend, actions: string[], tos: string[], values: BigNumber[], operations: number[]) => {
  let metatransactions: MetaTransaction[] = []
  for (let index = 0; index < actions.length; index++) {
    metatransactions.push({
      to: tos[index],
      value: values[index],
      data: actions[index],
      operation: operations[index],
    })
  }
  const encodedMetatransactions = encodeMultiSend(metatransactions)
  const multi_action = multisend.interface.encodeFunctionData('multiSend', [encodedMetatransactions])
  return multi_action
}

export const decodeMultiAction = (multisend: MultiSend, encoded: string) => {
  const OPERATION_TYPE = 2
  const ADDRESS = 40
  const VALUE = 64
  const DATA_LENGTH = 64

  const actions = multisend.interface.decodeFunctionData('multiSend', encoded)
  let transactionsEncoded = (actions[0] as string).slice(2)

  const transactions: MetaTransaction[] = []

  while (transactionsEncoded.length >= OPERATION_TYPE + ADDRESS + VALUE + DATA_LENGTH) {
    const thisTxLengthHex = transactionsEncoded.slice(OPERATION_TYPE + ADDRESS + VALUE, OPERATION_TYPE + ADDRESS + VALUE + DATA_LENGTH)
    const thisTxLength = BigNumber.from('0x' + thisTxLengthHex).toNumber()
    transactions.push({
      to: '0x' + transactionsEncoded.slice(2, OPERATION_TYPE + ADDRESS),
      value: '0x' + transactionsEncoded.slice(OPERATION_TYPE + ADDRESS, OPERATION_TYPE + ADDRESS + VALUE),
      data:
        '0x' +
        transactionsEncoded.slice(OPERATION_TYPE + ADDRESS + VALUE + DATA_LENGTH, OPERATION_TYPE + ADDRESS + VALUE + DATA_LENGTH + thisTxLength * 2),
      operation: parseInt(transactionsEncoded.slice(0, 2)),
    })
    transactionsEncoded = transactionsEncoded.slice(OPERATION_TYPE + ADDRESS + VALUE + DATA_LENGTH + thisTxLength * 2)
  }

  return transactions
}

export const hashOperation = (transactions: string): string => {
  const abiCoder = ethers.utils.defaultAbiCoder

  const encoded = abiCoder.encode(['bytes'], [transactions])

  const hashed = ethers.utils.solidityKeccak256(['bytes'], [encoded])

  return hashed
}
