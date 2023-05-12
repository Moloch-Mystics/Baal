import { mine, time } from "@nomicfoundation/hardhat-network-helpers";

export const blockTime = async () => {
    return time.latest();
};

export const blockNumber = async () => {
    return time.latestBlock();
};

export const moveForwardPeriods = async (
    blockTimeInSecs: number,
    blocks: number,
    extra: number = 1
) => {
    await mine(blocks + extra, { interval: blockTimeInSecs });
    return true;
};
