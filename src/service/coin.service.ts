import { eq } from "drizzle-orm";
import { aptosClient } from "../aptos";
import { db } from "../db";
import { coins } from "../db/schema";
import { Account, InputGenerateTransactionPayloadData } from "@aptos-labs/ts-sdk";

export const getCoins = async (addresses: string[]) => {
    try {
        const coinRes = (await aptosClient.queryIndexer({
            query: {
                query: `query GetFungibleAssetInfo($in: [String!], $offset: Int) {
fungible_asset_metadata(
  where: {asset_type: {_in: $in}},
  offset: $offset
) {
  symbol
  name
  decimals
  asset_type
  __typename
}
}`,
                variables: {
                    in: addresses,
                    offset: 0,
                },
            },
        })) as any;
        const rawCoins = coinRes["fungible_asset_metadata"];

        return rawCoins;
    } catch (error) {
        console.error("Error during coins list:", error);
    }
};

export const getCoinInfo = async (address: string) => {
    try {
        const tokenRes = await fetch(
            `https://www.dextools.io/shared/search/pair?query=${address
                .split("::")
                .slice(1)
                .join("::")}&chain=aptos`,
            {
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    Referer: "https://www.dextools.io/app",
                },
                method: "GET",
            }
        );

        let pairAddress = "";
        const tokenResJson = (await tokenRes.json())["results"];
        for (let el of tokenResJson) {
            if (el.id.tokenRef == "0x1::aptos_coin::AptosCoin" && el.id.token == address) {
                pairAddress = el.id.pair;
                break;
            }
        }
        if (!pairAddress) {
            throw new Error("Pair not found");
        }

        const [pairResp, candleResp] = await Promise.all([
            fetch(`https://www.dextools.io/shared/data/pair?address=${pairAddress}&chain=aptos`, {
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    Referer: "https://www.dextools.io/app",
                },
                method: "GET",
            }),
            fetch(
                `https://www.dextools.io/chain-aptos/api/generic/history/candles/v4?chain=aptos&latest=1h&sym=usd&pair=${pairAddress}`,
                {
                    headers: {
                        accept: "application/json",
                        "content-type": "application/json",
                        Referer: "https://www.dextools.io/app",
                    },
                    method: "GET",
                }
            ),
        ]);

        const pairResult = (await pairResp.json())["data"][0];
        if (!pairResult) {
            throw new Error("Pair not found");
        }
        const candleResults = (await candleResp.json())["data"]["candles"];
        const candleResult = candleResults[candleResults.length - 1];

        return {
            volume: candleResult.volume,
            price: candleResult.close,
            change: (candleResult.close - candleResult.open) / candleResult.open,
            mcap: pairResult.token.metrics.mcap,
            circulatingSupply: pairResult.token.metrics.circulatingSupply,
            totalSupply: pairResult.token.metrics.totalSupply,
            social: pairResult.token.links,
            name: pairResult.token.name,
            symbol: pairResult.token.symbol,
            liquidity: pairResult.metrics.liquidity,
        };
    } catch (error) {
        console.error("Error during coin info:", error);
    }
};

export const getOrCreateCachedCoin = async (address: string) => {
    try {
        const coin = await db.query.coins.findFirst({
            where: eq(coins.address, address),
        });

        if (coin) {
            return coin;
        }

        const coinOnChainInfo = await getCoins([address]);
        if (!coinOnChainInfo || coinOnChainInfo.length == 0) {
            throw new Error("Failed to fetch data");
        }

        const newCoins = await db
            .insert(coins)
            .values({
                address: address,
                symbol: coinOnChainInfo[0].symbol,
                decimals: coinOnChainInfo[0].decimals,
            })
            .returning()
            .execute();

        return newCoins[0];
    } catch (error) {
        console.error("Error during coin info:", error);
    }
};

export const getCacchedCoinByID = async (id: number) => {
    try {
        const coin = await db.query.coins.findFirst({
            where: eq(coins.id, id),
        });

        if (coin) {
            return coin;
        }
    } catch (error) {
        console.error("Error during coin info:", error);
    }
};

export const registerCoin = async (coinAddress: string) => {
    return {
        function: "0x1::managed_coin::register",
        typeArguments: [coinAddress],
        functionArguments: [],
    } as InputGenerateTransactionPayloadData;
};

export const isCoinRegistered = async (address: string, coinAddress: string) => {
    try {
        const resource = await aptosClient.getAccountResource({
            accountAddress: address,
            resourceType: `0x1::coin::CoinStore<${coinAddress}>`,
        });

        if (resource) {
            return true;
        }

        return false;
    } catch (error) {
        return false;
    }
};
