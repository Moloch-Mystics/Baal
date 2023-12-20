/*
  in order to adjust the build folder:
    1) import any files here you want in the build.
    2) copy the file path of the import.
    3) add the path to the ts.config.build.json under the { include: [...] } configuration.
    4) bump package.json version to publish a new package to npm.
*/
export { Baal } from "./types/contracts/Baal";
export { Baal__factory as BaalFactory } from "./types/factories/contracts/Baal__factory";
export { BaalSummoner } from "./types/contracts/BaalSummoner";
export { BaalSummoner__factory as BaalSummonerFactory } from "./types/factories/contracts/BaalSummoner__factory";
export { BaalAdvTokenSummoner } from "./types/contracts/higherOrderFactories/BaalAdvTokenSummoner";
export { BaalAdvTokenSummoner__factory as BaalAdvTokenSummonerFactory } from "./types/factories/contracts/higherOrderFactories/BaalAdvTokenSummoner__factory";
export { BaalAndVaultSummoner } from "./types/contracts/higherOrderFactories/BaalAndVaultSummoner";
export { BaalAndVaultSummoner__factory as BaalAndVaultFactory } from "./types/factories/contracts/higherOrderFactories/BaalAndVaultSummoner__factory";
export { Loot } from "./types/contracts/LootERC20.sol/Loot";
export { Loot__factory as LootFactory } from "./types/factories/contracts/LootERC20.sol/Loot__factory";
export { Shares } from "./types/contracts/SharesERC20.sol/Shares";
export { Shares__factory as SharesFactory } from "./types/factories/contracts/SharesERC20.sol/Shares__factory";
export { Poster } from "./types/contracts/utils/Poster";
export { Poster__factory as PosterFactory } from "./types/factories/contracts/utils/Poster__factory";
export { TributeMinion } from "./types/contracts/tools/TributeMinion.sol/TributeMinion";
export { TributeMinion__factory as TributeMinionFactory } from "./types/factories/contracts/tools/TributeMinion.sol/TributeMinion__factory";
export { MultiSend } from "./types/@gnosis.pm/safe-contracts/contracts/libraries/MultiSend";
export { MultiSend__factory as MultiSendFactory } from "./types/factories/@gnosis.pm/safe-contracts/contracts/libraries/MultiSend__factory";

// Interfaces
export { IBaalToken } from "./types/contracts/interfaces/IBaalToken";
export { IBaal } from "./types/contracts/interfaces/IBaal";

export * from "./addresses/setup";
export { deployments as DEPLOYMENT_ADDRESSES } from "./addresses/deployed";
