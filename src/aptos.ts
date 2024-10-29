import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { SDK } from "@pontem/liquidswap-sdk";

export const aptosClient = new Aptos(new AptosConfig({ network: Network.MAINNET }));

export const swapClient = new SDK({
    nodeUrl: "https://fullnode.mainnet.aptoslabs.com/v1",
});
