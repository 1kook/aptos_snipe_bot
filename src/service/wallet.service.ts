import {
    Account,
    Aptos,
    AptosConfig,
    Ed25519PrivateKey,
    Network,
    UserTransactionResponse,
} from "@aptos-labs/ts-sdk";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { users, Wallet, wallets } from "../db/schema";
import { SECRET } from "../config";
import { decryptData, encryptData } from "../util/crypto";
import { ethers } from "ethers";
import { aptosClient } from "../aptos";
import { getCoins } from "./coin.service";
import { AptosAccount, Types } from "aptos";

export const createWallet = async (userId: number) => {
    try {
        const defaultWallet = await getDefaultWallet(userId);
        const wallet = Account.generate();
        const encrytedPrivateKey = encryptData(wallet.privateKey.toString(), SECRET);

        const newWallets = await db
            .insert(wallets)
            .values({
                userId: userId,
                address: wallet.accountAddress.toString(),
                encryptedPrivateKey: encrytedPrivateKey,
                isDefault: !defaultWallet,
            })
            .returning()
            .execute();

        return {
            newWallet: newWallets[0],
            privateKey: wallet.privateKey.toString(),
        };
    } catch (error) {
        console.error("Error during wallet creation:", error);
    }
};

export const getListWallets = async (userId: number) => {
    try {
        const fetchWallets = await db.query.wallets.findMany({
            where: eq(wallets.userId, userId),
            orderBy: [asc(wallets.id)],
        });
        return fetchWallets;
    } catch (error) {
        console.error("Error during wallet list:", error);
    }
};

export const getWalletById = async (walletId: number, userId: number) => {
    try {
        const fetchWallet = await db.query.wallets.findFirst({
            where: and(eq(wallets.id, walletId), eq(wallets.userId, userId)),
        });
        return fetchWallet;
    } catch (error) {
        console.error("Error during wallet fetch:", error);
    }
};

export const getDefaultWallet = async (userId: number) => {
    try {
        const fetchWallet = await db.query.wallets.findFirst({
            where: and(eq(wallets.userId, userId), eq(wallets.isDefault, true)),
        });
        return fetchWallet;
    } catch (error) {
        console.error("Error during wallet fetch:", error);
    }
};

export const getListPositions = async (walletAddress: string) => {
    try {
        const balanceRes = (await aptosClient.queryIndexer({
            query: {
                query: `
                    query GetFungibleAssetBalances($address: String, $offset: Int) {
current_fungible_asset_balances(
  where: {owner_address: {_eq: $address}},
  offset: $offset,
  limit: 100,
  order_by: {amount: desc}
) {
  asset_type
  amount
  __typename
}
}`,
                variables: {
                    address: walletAddress,
                    offset: 0,
                },
            },
        })) as any;
        const rawPositions = balanceRes["current_fungible_asset_balances"];

        const listCoins = rawPositions.map((position: any) => {
            return position["asset_type"];
        });
        const coins = await getCoins(listCoins);

        const positions = [];

        for (let i = 0; i < coins.length; i++) {
            for (let j = 0; j < rawPositions.length; j++) {
                if (
                    coins[i]["asset_type"] === rawPositions[j]["asset_type"] &&
                    rawPositions[j]["amount"] != "0"
                ) {
                    positions.push({
                        name: coins[i]["name"],
                        symbol: coins[i]["symbol"],
                        assetType: coins[i]["asset_type"],
                        decimals: coins[i]["decimals"],
                        amount: rawPositions[j]["amount"],
                    });
                }
            }
        }

        return positions;
    } catch (error) {
        console.error("Error during wallet balance:", error);
    }
};

export const getBalance = async (walletAddress: string, coinAddress: string) => {
    const [balance] = await aptosClient.view<[string]>({
        payload: {
            function: "0x1::coin::balance",
            typeArguments: [coinAddress],
            functionArguments: [walletAddress],
        },
    });

    return balance;
};

export const signAndBroadcastTransaction = async (wallet: Wallet, txn: any) => {
    const decryptedPrivateKey = decryptData(wallet.encryptedPrivateKey as string, SECRET);
    const privKey = new Ed25519PrivateKey(decryptedPrivateKey);
    const signer = Account.fromPrivateKey({
        privateKey: privKey,
    });

    const transaction = await aptosClient.transaction.build.simple({
        sender: signer.accountAddress.toString(),
        data: txn,
    });

    const pendingTxn = await aptosClient.transaction.signAndSubmitTransaction({
        signer: signer,
        transaction: transaction,
    });

    const executedTransaction = await aptosClient.waitForTransaction({
        transactionHash: pendingTxn.hash,
    });

    return executedTransaction as UserTransactionResponse;
};

export const deleteWalletById = async (walletId: number, userId: number) => {
    try {
        await db.delete(wallets).where(and(eq(wallets.userId, userId), eq(wallets.id, walletId)));
    } catch (error) {
        console.error("Error during wallet deletion:", error);
    }
};

export const setDefaultWallet = async (walletId: number, userId: number) => {
    try {
        const wallet = await getWalletById(walletId, userId);
        if (!wallet) {
            return;
        }

        await db
            .update(wallets)
            .set({ isDefault: false })
            .where(and(eq(wallets.userId, userId), ne(wallets.id, walletId)));
        await db
            .update(wallets)
            .set({ isDefault: !wallet.isDefault })
            .where(and(eq(wallets.userId, userId), eq(wallets.id, walletId)));
    } catch (error) {
        console.error("Error during wallet default:", error);
    }
};

export const renameWallet = async (walletId: number, label: string) => {
    try {
        await db.update(wallets).set({ label: label }).where(eq(wallets.id, walletId));
    } catch (error) {
        console.error("Error during wallet rename:", error);
    }
};
