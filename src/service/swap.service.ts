import { Account, InputGenerateTransactionPayloadData } from "@aptos-labs/ts-sdk";
import { aptosClient, swapClient } from "../aptos";
import { Input } from "telegraf";

interface SwapParams {
    from: string;
    fromToken: string;
    toToken: string;
    amount: number;
    slippage: number;
}

export const getSwapRate = async (params: SwapParams) => {
    try {
        const output = await swapClient.Swap.calculateRates({
            fromToken: params.fromToken,
            toToken: params.toToken,
            amount: params.amount,
            curveType: "uncorrelated",
            interactiveToken: "from",
            version: 0.5,
        });

        return Number(output);
    } catch (e) {
        console.log(e);
    }
}

export const createSwap = async (params: SwapParams) => {
    try {
        const output = await getSwapRate(params);
        if (!output) {
            throw new Error("Failed to get swap rate");
        }

        const swapTransactionPayload = swapClient.Swap.createSwapTransactionPayload({
            fromToken: params.fromToken,
            toToken: params.toToken,
            fromAmount: params.amount,
            toAmount: output,
            interactiveToken: "from",
            slippage: 0.005,
            stableSwapType: "normal",
            curveType: "uncorrelated",
            version: 0.5,
        });

        const txn: InputGenerateTransactionPayloadData = {
            function: swapTransactionPayload.function as any,
            typeArguments: swapTransactionPayload.type_arguments,
            functionArguments: swapTransactionPayload.arguments,
        };

        return txn;
    } catch (e) {
        console.log(e);
    }
};
