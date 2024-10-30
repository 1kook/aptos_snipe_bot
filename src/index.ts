import { Context, session, Telegraf } from "telegraf";
import { TELEGRAM_BOT_TOKEN } from "./config";
import { message } from "telegraf/filters";
import {
    createWallet,
    deleteWalletById,
    getBalance,
    getDefaultWallet,
    getListPositions,
    getListWallets,
    getWalletById,
    renameWallet,
    setDefaultWallet,
    signAndBroadcastTransaction,
} from "./service/wallet.service";
import { getOrCreateUser } from "./service/user.service";
import { createSwap, getSwapRate } from "./service/swap.service";
import {
    getCacchedCoinByID,
    getCoinInfo,
    getCoins,
    getOrCreateCachedCoin,
    isCoinRegistered,
    registerCoin,
} from "./service/coin.service";
import { convertValueToDecimal } from "@pontem/liquidswap-sdk";
import { cryptoAmountRound, marketCapRound } from "./util/format";
import { textOverflow } from "./util/textOverflow";
import { Coin, User, Wallet, wallets } from "./db/schema";
import { ethers } from "ethers";
import type { Update } from "telegraf/types";
import { NATIVE_COIN, NATIVE_DECIMAL } from "./constant";

interface MyContext<U extends Update = Update> extends Context<U> {
    session: {
        awaitingTradeAddress?: {
            messageId: number;
            walletId: number;
        };
        awaitingWalletRename?: {
            messageId: number;
            walletId: number;
        };
        awaitingWithdrawal?: {
            messageId: number;
            fromAddress: string;
        };
        awaitingBuyCustom?: {
            messageId: number;
            walletId: number;
            coinId: number;
        };
        awaitingSellCustom?: {
            messageId: number;
            coinId: number;
        };
    };
}

const bot = new Telegraf<MyContext>(TELEGRAM_BOT_TOKEN);
bot.use(session());

bot.start(async (ctx) => {
    const user = await getOrCreateUser(ctx.from.id.toString());
    if (!user) {
        return ctx.reply("Failed to create user.");
    }

    const menu = getMainMenu(ctx.from.username);
    return ctx.reply(menu.text, menu.options);
});

bot.action("back_to_menu", async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const menu = getMainMenu(ctx.from.username);
        return ctx.editMessageText(menu.text, menu.options);
    } catch (err) {
        console.error("Error in back_to_menu action:", err);
        return ctx.reply(
            "An unexpected error occurred while navigating to the main menu. Please try again later."
        );
    }
});

bot.action(/^trade_(\d+|main)$/, async (ctx) => {
    const params = ctx.match;
    let [_, walletId] = params;
    if (walletId == "main") {
        const fetchUser = await getOrCreateUser(ctx.from.id.toString());
        if (!fetchUser) {
            return ctx.reply("Failed to fetch user.");
        }
        const defaultWallet = await getDefaultWallet(fetchUser.id);
        if (!defaultWallet) {
            return ctx.reply("No default wallet found.");
        }
        walletId = defaultWallet.id.toString();
    }
    try {
        await ctx.answerCbQuery();
        const msg = await ctx.reply(
            "Reply to this message with the token address that you want to trade:",
            {
                reply_markup: { force_reply: true },
            }
        );

        ctx.session = {
            ...ctx.session,
            awaitingTradeAddress: {
                messageId: msg.message_id,
                walletId: Number(walletId),
            },
        };
    } catch (err) {
        console.error("Error in trade action:", err);
        return ctx.reply(
            "An unexpected error occurred while initiating the trade request. Please try again later."
        );
    }
});

bot.action(/^tradewithcoin_(\d+)_(\d+)$/, async (ctx) => {
    const params = ctx.match;
    let [_, walletId, coinId] = params;
    const fetchUser = await getOrCreateUser(ctx.from.id.toString());
    if (!fetchUser) {
        return ctx.reply("Failed to fetch user.");
    }

    if (walletId == "main") {
        const defaultWallet = await getDefaultWallet(fetchUser.id);
        if (!defaultWallet) {
            return ctx.reply("No default wallet found.");
        }
        walletId = defaultWallet.id.toString();
    }
    try {
        await ctx.answerCbQuery();
        const wallet = await getWalletById(Number(walletId), fetchUser.id);
        if (!wallet) {
            return ctx.reply("Trade: Failed to fetch wallet.");
        }
        const { text, cachedCoin } = await getCoinInfoMessage(undefined, Number(coinId), wallet);

        return ctx.editMessageText(text, {
            parse_mode: "HTML",
            reply_markup: getTradeInlineKeyboard(cachedCoin, wallet),
            link_preview_options: {
                is_disabled: true,
            },
        });
    } catch (err) {
        console.error("Error in trade action:", err);
        return ctx.reply(
            "An unexpected error occurred while initiating the trade request. Please try again later."
        );
    }
});

bot.action("wallet_menu", async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const fetchUser = await getOrCreateUser(ctx.from.id.toString());
        if (!fetchUser) throw new Error("Failed to fetch user");

        const listWallets = await getListWallets(fetchUser.id);
        const listWalletsWithBalance = await Promise.all(
            listWallets?.map(async (wallet) => {
                const balance = await getBalance(wallet.address, NATIVE_COIN);
                return {
                    ...wallet,
                    balance: balance || "0",
                };
            }) || []
        );

        const walletButtons =
            listWalletsWithBalance?.map((wallet) => [
                {
                    text: `${wallet.isDefault ? "🟢" : "🔘"} 💳 ${textOverflow(
                        wallet.address,
                        5
                    )} | ${cryptoAmountRound(
                        ethers.formatUnits(wallet.balance, NATIVE_DECIMAL)
                    )} APT`,
                    callback_data: `wallet_${wallet.id}`,
                },
            ]) || [];

        return ctx.editMessageText("Wallet Management:", {
            reply_markup: {
                inline_keyboard: [
                    ...walletButtons,
                    [{ text: "➕ Create New Wallet", callback_data: "wallet_create" }],
                    [{ text: "⬅ Back", callback_data: "back_to_menu" }],
                ],
            },
        });
    } catch (err) {
        console.error("Error in menu_wallet action:", err);
        return ctx.reply(
            "An unexpected error occurred while accessing wallet management. Please try again later."
        );
    }
});

bot.action("wallet_create", async (ctx) => {
    try {
        const fetchUser = await getOrCreateUser(ctx.from.id.toString());
        if (!fetchUser) throw new Error("Failed to fetch user");

        const newWalletResp = await createWallet(fetchUser.id);
        if (!newWalletResp) throw new Error("Failed to create wallet");

        const newWallet = newWalletResp.newWallet;
        const privateKey = newWalletResp.privateKey;
        if (!newWallet) throw new Error("Failed to create wallet");

        return await ctx.editMessageText(
            `Generated new wallet:

            Address: <code>${newWallet.address}</code>
            Private Key: <code>${privateKey}</code>

            ⚠️ Make sure to save this private key using pen and paper only. Do NOT copy-paste it anywhere. You could also import it to your wallet. After you finish saving/importing the wallet credentials, delete this message. The bot will not display this information again.`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "💳 " + textOverflow(newWallet.address, 5),
                                callback_data: "wallet_" + newWallet.id,
                            },
                            {
                                text: "⬅ Back",
                                callback_data: "wallet_menu",
                            },
                        ],
                    ],
                },
            }
        );
    } catch (err) {
        console.error("Error in wallet_create action:", err);
        return ctx.reply(
            "An unexpected error occurred while creating the wallet. Please try again later."
        );
    }
});

bot.action("close", async (ctx) => {
    try {
        await ctx.answerCbQuery();
        return ctx.deleteMessage();
    } catch (err) {
        console.error("Error in close action:", err);
        return ctx.reply(
            "An unexpected error occurred while closing the message. Please try again later."
        );
    }
});

bot.action(/^(buy|custombuy)_(\d+)_(\d+)_(\d+(?:\.\d+)?|custom)$/, async (ctx) => {
    const params = ctx.match;
    const [_, type, walletId, buyCoinId, amount] = params;
    try {
        await ctx.answerCbQuery();
        if (amount == "custom") {
            const msg = await ctx.reply("Reply to this message with the amount you want to buy:", {
                reply_markup: { force_reply: true },
            });

            ctx.session = {
                ...ctx.session,
                awaitingBuyCustom: {
                    messageId: msg.message_id,
                    walletId: Number(walletId),
                    coinId: Number(buyCoinId),
                },
            };

            return;
        }

        const coin = await getCacchedCoinByID(Number(buyCoinId));
        if (!coin || !coin.address) throw new Error("Failed to fetch the coin ID");

        const fetchUser = await getOrCreateUser(ctx.from.id.toString());
        if (!fetchUser) throw new Error("Failed to fetch user");

        const wallet = await getWalletById(Number(walletId), fetchUser.id);
        if (!wallet) throw new Error("Failed to fetch wallet");

        let chatId, messageId;
        if (type == "buy") {
            const pendingMsg = await ctx.reply(
                `<a href="https://explorer.aptoslabs.com/account/${
                    wallet.address
                }">[💳 ${textOverflow(wallet.address, 5)}]</a> ⏳ Sending transaction...`,
                {
                    parse_mode: "HTML",
                    link_preview_options: {
                        is_disabled: true,
                    },
                }
            );
            chatId = pendingMsg.chat.id;
            messageId = pendingMsg.message_id;
        } else {
            await ctx.editMessageText(
                `<a href="https://explorer.aptoslabs.com/account/${
                    wallet.address
                }">[💳 ${textOverflow(wallet.address, 5)}]</a> ⏳ Sending transaction...`,
                {
                    parse_mode: "HTML",
                    link_preview_options: {
                        is_disabled: true,
                    },
                }
            );
            chatId = ctx.chat?.id;
            messageId = ctx.msgId;
        }

        const hasRegistered = await isCoinRegistered(wallet.address, coin.address);
        if (!hasRegistered) {
            const registerTx = await registerCoin(coin.address);
            await signAndBroadcastTransaction(wallet, registerTx);
        }

        const swapTx = await createSwap({
            from: wallet.address,
            fromToken: NATIVE_COIN,
            toToken: coin.address,
            amount: convertValueToDecimal(amount, NATIVE_DECIMAL).toNumber(),
            slippage: 0.005,
        });
        const tx = await signAndBroadcastTransaction(wallet, swapTx);
        if (!tx) throw new Error("Failed to sign and broadcast transaction");
        if (!tx.success) throw new Error(tx.event_root_hash);

        let outAmountUnit = 0;
        for (let event of tx.events) {
            if (event.type.includes("liquidity_pool::SwapEvent")) {
                outAmountUnit = Number(event.data["x_out"]) || Number(event.data["y_out"]);
            }
        }

        const outAmount = ethers.formatUnits(outAmountUnit, coin.decimals);
        return ctx.telegram.editMessageText(
            chatId,
            messageId,
            undefined,
            `<a href=\"https://explorer.aptoslabs.com/account/${
                wallet.address
            }\">[💳 ${textOverflow(
                wallet.address,
                5
            )}]</a> ✅ Swapped ${amount} APT ➡️ ${outAmount} ${
                coin.symbol
            } (<a href=\"https://explorer.aptoslabs.com/txn/${tx?.hash}\">${textOverflow(
                tx?.hash,
                5
            )}</a>)`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "Close",
                                callback_data: "close",
                            },
                        ],
                    ],
                },
                link_preview_options: {
                    is_disabled: true,
                },
            }
        );
    } catch (error: any) {
        console.error("Error in buy action:", error);
        return ctx.reply(
            `An error occurred during the buy process: ${error.message}. Please try again.`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "Retry",
                                callback_data: `buy_${walletId}_${buyCoinId}_${amount}`,
                            },
                            {
                                text: "Close",
                                callback_data: "close",
                            },
                        ],
                    ],
                },
            }
        );
    }
});

bot.action(/^(sell|customsell)_(\d+)_(\d+)_(\d+(?:\.\d+)?|custom)$/, async (ctx) => {
    const params = ctx.match;
    const [_, type, walletId, sellCoinId, percentageAmount] = params;
    try {
        await ctx.answerCbQuery();

        if (Number(percentageAmount) < 1 || Number(percentageAmount) > 100) {
            return ctx.reply("Invalid percentage. Please choose between 1-100%");
        }

        const coin = await getCacchedCoinByID(Number(sellCoinId));
        if (!coin || !coin.address) throw new Error("Failed to fetch the coin ID");

        const fetchUser = await getOrCreateUser(ctx.from.id.toString());
        if (!fetchUser) throw new Error("Failed to fetch user");

        const wallet = await getWalletById(Number(walletId), fetchUser.id);
        if (!wallet) throw new Error("Failed to fetch wallet");

        let chatId, messageId;
        if (type == "sell") {
            const pendingMsg = await ctx.reply(
                `<a href="https://explorer.aptoslabs.com/account/${
                    wallet.address
                }">[💳 ${textOverflow(wallet.address, 5)}]</a> ⏳ Sending transaction...`,
                {
                    parse_mode: "HTML",
                    link_preview_options: {
                        is_disabled: true,
                    },
                }
            );
            chatId = pendingMsg.chat.id;
            messageId = pendingMsg.message_id;
        } else {
            await ctx.editMessageText(
                `<a href="https://explorer.aptoslabs.com/account/${
                    wallet.address
                }">[💳 ${textOverflow(wallet.address, 5)}]</a> ⏳ Sending transaction...`,
                {
                    parse_mode: "HTML",
                    link_preview_options: {
                        is_disabled: true,
                    },
                }
            );
            chatId = ctx.chat?.id;
            messageId = ctx.msgId;
        }

        const balance = await getBalance(wallet.address, coin.address);
        if (!balance || balance === "0") throw new Error(`No ${coin.symbol} balance to sell`);

        const amountToSell = (BigInt(balance) * BigInt(percentageAmount)) / BigInt(100);

        const swapTx = await createSwap({
            from: wallet.address,
            fromToken: coin.address,
            toToken: NATIVE_COIN,
            amount: Number(amountToSell.toString()),
            slippage: 0.005,
        });

        const tx = await signAndBroadcastTransaction(wallet, swapTx);
        if (!tx) throw new Error("Failed to sign and broadcast transaction");
        if (!tx.success) throw new Error(tx.event_root_hash);

        let outAmountUnit = 0;
        for (let event of tx.events) {
            if (event.type.includes("liquidity_pool::SwapEvent")) {
                outAmountUnit = Number(event.data["x_out"]) || Number(event.data["y_out"]);
            }
        }

        const outAmount = ethers.formatUnits(outAmountUnit, NATIVE_DECIMAL);
        const soldAmount = ethers.formatUnits(amountToSell, coin.decimals);

        return ctx.telegram.editMessageText(
            chatId,
            messageId,
            undefined,
            `<a href=\"https://explorer.aptoslabs.com/account/${
                wallet.address
            }\">[💳 ${textOverflow(wallet.address, 5)}]</a> ✅ Swapped ${soldAmount} ${
                coin.symbol
            } ➡️ ${outAmount} APT (<a href=\"https://explorer.aptoslabs.com/txn/${
                tx?.hash
            }\">${textOverflow(tx?.hash, 5)}</a>)`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "Close",
                                callback_data: "close",
                            },
                        ],
                    ],
                },
                link_preview_options: {
                    is_disabled: true,
                },
            }
        );
    } catch (error: any) {
        console.error("Error in sell action:", error);
        return ctx.reply(
            `An error occurred during the sell process: ${error.message}. Please try again.`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "Retry",
                                callback_data: `sell_${walletId}_${sellCoinId}_${percentageAmount}`,
                            },
                            {
                                text: "Close",
                                callback_data: "close",
                            },
                        ],
                    ],
                },
            }
        );
    }
});

bot.action(/^wallet_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const walletId = ctx.match[1];

    const fetchUser = await getOrCreateUser(ctx.from.id.toString());
    if (!fetchUser) {
        return ctx.reply("Failed to fetch user.");
    }

    let currentWallet: Wallet | undefined;
    if (ctx.match[0] == "main") {
        currentWallet = await getDefaultWallet(fetchUser.id);
    } else {
        currentWallet = await getWalletById(Number(walletId), fetchUser.id);
    }

    if (!currentWallet) {
        return ctx.reply("Failed to fetch wallet.");
    }

    try {
        const balance = await getBalance(currentWallet.address, NATIVE_COIN);
        const isDefault = currentWallet?.isDefault; // You'll need to add this field

        const message = `
💳 Wallet Details

📝 Name: ${currentWallet.label || "Unnamed Wallet"}
${isDefault ? "✅ Default Wallet" : ""}

📍 Address: 
<code>${currentWallet.address}</code>

💰 Balance: ${cryptoAmountRound(ethers.formatUnits(balance, NATIVE_DECIMAL))} APT
`;

        return ctx.editMessageText(message, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "🚀 Trade",
                            callback_data: `trade_${currentWallet.id}`,
                        },
                        {
                            text: "📍 Positions",
                            callback_data: `positions_${currentWallet.id}`,
                        },
                    ],
                    [
                        { text: "✏️ Rename", callback_data: `wallet_rename_${currentWallet.id}` },
                        {
                            text: isDefault ? "✅ Default" : "⭐️ Make Default",
                            callback_data: `wallet_default_${currentWallet.id}`,
                        },
                    ],
                    [
                        {
                            text: "💸 Withdraw",
                            callback_data: `wallet_withdraw_${currentWallet.id}`,
                        },
                        { text: "🗑️ Delete", callback_data: `wallet_delete_${currentWallet.id}` },
                    ],
                    [
                        {
                            text: "⬅ Back",
                            callback_data: "wallet_menu",
                        },
                    ],
                ],
            },
        });
    } catch (error) {
        return ctx.reply("Failed to fetch wallet details. Please try again.");
    }
});

bot.action(/^wallet_rename_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const walletId = ctx.match[1];

    const msg = await ctx.reply("Reply to this message with the new wallet name:", {
        reply_markup: { force_reply: true },
    });

    ctx.session = {
        ...ctx.session,
        awaitingWalletRename: {
            messageId: msg.message_id,
            walletId: Number(walletId),
        },
    };
});

bot.action(/^wallet_delete_(\d+)$/, async (ctx) => {
    const walletId = Number(ctx.match[1]);

    await ctx.editMessageText(
        "⚠️ Are you sure you want to delete this wallet? This action cannot be undone.",
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "✅ Yes, Delete",
                            callback_data: `wallet_delete_confirm_${walletId}`,
                        },
                        { text: "❌ No, Cancel", callback_data: `wallet_${walletId}` },
                    ],
                ],
            },
        }
    );
});

bot.action(/^wallet_default_(\d+)$/, async (ctx) => {
    const walletId = Number(ctx.match[1]);
    const fetchUser = await getOrCreateUser(ctx.from.id.toString());
    if (!fetchUser) {
        return ctx.reply("Failed to fetch user.");
    }

    try {
        await setDefaultWallet(walletId, fetchUser.id);

        // Refresh wallet details
        await bot.handleUpdate({
            ...ctx.update,
            callback_query: {
                ...ctx.callbackQuery,
                data: `wallet_${walletId}`,
            },
        });

        return await ctx.answerCbQuery("✅ Default wallet updated successfully!");
    } catch (error) {
        await ctx.answerCbQuery("❌ Failed to update default wallet");
    }
});

bot.action(/^wallet_withdraw_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const walletAddress = ctx.match[1];

    const msg = await ctx.reply(
        "Reply to this message with the withdrawal details in format:\n" +
            "<recipient_address> <amount>\n" +
            "Example: 0x123...abc 10.5",
        {
            parse_mode: "HTML",
            reply_markup: { force_reply: true },
        }
    );

    ctx.session = {
        ...ctx.session,
        awaitingWithdrawal: {
            messageId: msg.message_id,
            fromAddress: walletAddress,
        },
    };
});

bot.action(/^wallet_delete_confirm_(\d+)$/, async (ctx) => {
    const walletId = Number(ctx.match[1]);

    const fetchUser = await getOrCreateUser(ctx.from.id.toString());
    if (!fetchUser) {
        return ctx.reply("Failed to fetch user.");
    }

    await ctx.answerCbQuery();
    try {
        await deleteWalletById(walletId, fetchUser.id);
        return ctx.editMessageText("✅ Wallet deleted successfully!", {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "Close",
                            callback_data: "close",
                        },
                    ],
                ],
            },
        });
    } catch (error) {
        return ctx.editMessageText("❌ Failed to delete wallet. Please try again.");
    }
});

bot.action(/^positions_(\d+)$/, async (ctx) => {
    const walletId = Number(ctx.match[1]);

    const fetchUser = await getOrCreateUser(ctx.from.id.toString());
    if (!fetchUser) {
        return ctx.reply("Failed to fetch user.");
    }

    const currentWallet = await getWalletById(walletId, fetchUser.id);
    if (!currentWallet) {
        return ctx.reply("Failed to fetch wallet.");
    }

    const inlineKeyboard = [];

    const positions = await getListPositions(currentWallet.address);
    if (positions && positions.length > 0) {
        const results = await Promise.all(
            positions.map(async (pos) => {
                // if (pos.assetType === NATIVE_COIN) {
                //     return null;
                // }
                const cachedCoin = await getOrCreateCachedCoin(pos.assetType);
                return {
                    cachedCoin,
                    pos,
                };
            })
        );

        results.forEach((result) => {
            if (result && result.cachedCoin) {
                const { pos, cachedCoin } = result;
                inlineKeyboard.push([
                    {
                        text: `${pos.name}: ${cryptoAmountRound(
                            ethers.formatUnits(pos.amount, pos.decimals)
                        )} ${pos.symbol}`,
                        callback_data: `tradewithcoin_${walletId}_${cachedCoin.id}`,
                    },
                ]);
            }
        });
    }

    inlineKeyboard.push([
        {
            text: "⬅ Back",
            callback_data: `wallet_${walletId}`,
        },
    ]);

    return ctx.editMessageText(
        `📍 Positions

Address: <code>${currentWallet.address}</code>
`,
        {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: inlineKeyboard,
            },
        }
    );
});

bot.on(message("text"), async (ctx) => {
    const fetchUser = await getOrCreateUser(ctx.from.id.toString());
    if (!fetchUser) {
        return ctx.reply("Failed to fetch user.");
    }

    if (ctx.message.reply_to_message) {
        const replyToId = ctx.message.reply_to_message.message_id;

        if (ctx.session?.awaitingTradeAddress?.messageId === replyToId) {
            const address = ctx.message.text;
            let wallet = await getWalletById(
                ctx.session.awaitingTradeAddress.walletId,
                fetchUser.id
            );
            if (!wallet) {
                return ctx.reply("Buy: Failed to fetch wallet.");
            }

            try {
                const { text, cachedCoin } = await getCoinInfoMessage(address, undefined, wallet);
                return ctx.replyWithHTML(text, {
                    parse_mode: "HTML",
                    reply_markup: getTradeInlineKeyboard(cachedCoin, wallet),
                    link_preview_options: {
                        is_disabled: true,
                    },
                });
            } catch (error) {
                return ctx.reply("Buy: Failed to fetch coin info.");
            } finally {
                ctx.session.awaitingTradeAddress = undefined;
            }
        } else if (ctx.session?.awaitingWalletRename?.messageId === replyToId) {
            const { walletId } = ctx.session.awaitingWalletRename;
            const newName = ctx.message.text;

            try {
                await renameWallet(walletId, newName);
                // call action
                return await ctx.editMessageText("✅ Wallet renamed successfully!", {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "⬅ Back",
                                    callback_data: "wallet_menu",
                                },
                            ],
                        ],
                    },
                });
            } catch (error) {
                return ctx.reply("Failed to rename wallet. Please try again.");
            } finally {
                ctx.session.awaitingWalletRename = undefined;
            }
        } else if (ctx.session?.awaitingWithdrawal?.messageId === replyToId) {
            const { fromAddress } = ctx.session.awaitingWithdrawal;
            const [toAddress, amount] = ctx.message.text.split(" ");

            if (!toAddress || !amount || isNaN(Number(amount))) {
                return ctx.reply("Invalid format. Please use: address amount");
            }

            try {
                return await ctx.reply("✅ Withdrawal initiated successfully!", {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "⬅ Back",
                                    callback_data: "wallet_menu",
                                },
                            ],
                        ],
                    },
                });
            } catch (error) {
                return ctx.reply("Failed to initiate withdrawal. Please try again.");
            } finally {
                ctx.session.awaitingWithdrawal = undefined;
            }
        } else if (ctx.session?.awaitingBuyCustom?.messageId === replyToId) {
            const { walletId, coinId } = ctx.session.awaitingBuyCustom;
            const amount = ctx.message.text;
            try {
                return await ctx.reply(`Confirm buy with ${amount} APT`, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "✅ Confirm",
                                    callback_data: `custombuy_${walletId}_${coinId}_${amount}`,
                                },
                                {
                                    text: "❌ Cancel",
                                    callback_data: "close",
                                },
                            ],
                        ],
                    },
                });
            } catch (error) {
                console.log(error);
            } finally {
                ctx.session.awaitingBuyCustom = undefined;
            }
        }
    } else {
        const address = ctx.message.text;
        let wallet = await getDefaultWallet(fetchUser.id);
        if (!wallet) {
            return ctx.reply("Buy: Failed to fetch wallet.");
        }

        try {
            const { text, cachedCoin } = await getCoinInfoMessage(address, undefined, wallet);
            return ctx.replyWithHTML(text, {
                parse_mode: "HTML",
                reply_markup: getTradeInlineKeyboard(cachedCoin, wallet),
                link_preview_options: {
                    is_disabled: true,
                },
            });
        } catch (error) {
            return ctx.reply("Failed to fetch token info. Please check the address and try again.");
        }
    }
});

function getMainMenu(username?: string) {
    const welcomeText = `Welcome!`;

    return {
        text: welcomeText,
        options: {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Trade now", callback_data: "trade_main" }],
                    [{ text: "💳 Wallet", callback_data: "wallet_menu" }],
                ],
            },
        },
    };
}

async function getCoinInfoMessage(
    address: string | undefined,
    id: number | undefined,
    wallet: Wallet
) {
    try {
        if (!address && !id) {
            throw new Error("No address or ID specified");
        }

        const cachedCoin = address
            ? await getOrCreateCachedCoin(address)
            : await getCacchedCoinByID(id!);

        if (!cachedCoin?.address) {
            throw new Error(`Failed to fetch coin ${address ? "using address" : "using ID"}`);
        }

        const [info, rate, nativeBalance, tokenBalance] = await Promise.all([
            getCoinInfo(cachedCoin.address),
            getSwapRate({
                fromToken: NATIVE_COIN,
                toToken: cachedCoin.address,
                amount: convertValueToDecimal(1, NATIVE_DECIMAL).toNumber(),
                from: "",
                slippage: 0,
            }),
            getBalance(wallet.address, NATIVE_COIN),
            getBalance(wallet.address, cachedCoin.address),
        ]);
        if (!info) {
            throw new Error("Failed to fetch coin info");
        }

        const website = Object.entries(info.social)
            .filter(([_, url]) => url)
            .map(([platform, url]) => `<a href="${url}">${platform}</a>`)
            .join(" ");

        const formattedRate = ethers.formatUnits(rate || 0, cachedCoin.decimals);

        return {
            text: `<code>${info.name} - ${info.symbol}</code>
<a href="https://explorer.aptoslabs.com/coin/${address ?? cachedCoin.address}">CA</a> - <code>${
                address ?? cachedCoin.address
            }</code>

🪙 Price: $${cryptoAmountRound(info.price || 0)} • ${(info.change || 0 * 100).toFixed(2)}%
📊 Volume: ${info.volume ? marketCapRound(info.volume, "$") : "-"}
💧 Liquidity: ${info.liquidity ? marketCapRound(info.liquidity, "$") : "-"}
💰 MarketCap: ${info.mcap ? marketCapRound(info.mcap, "$") : "-"}

🌐 Website: ${website}

🔀 Rate: 1 APT ~ ${formattedRate} ${info.symbol}
🏦 Balance:
 └APT: ${cryptoAmountRound(ethers.formatUnits(nativeBalance || 0, NATIVE_DECIMAL))}
 └${cachedCoin.symbol}: ${cryptoAmountRound(
                ethers.formatUnits(tokenBalance || 0, cachedCoin.decimals)
            )}

🕓 Last updated: ${new Date().toUTCString()}
`,
            cachedCoin,
        };
    } catch (error: any) {
        console.error("Error in getCoinInfoMessage:", error);
        throw new Error(`Failed to retrieve coin information: ${error.message}`);
    }
}

function getTradeInlineKeyboard(coin: Coin, wallet: Wallet) {
    return {
        inline_keyboard: [
            [
                {
                    text: "🔍 Explorer",
                    url: `https://explorer.aptoslabs.com/account/${coin.address}`,
                },
                {
                    text: "🔄",
                    callback_data: `tradewithcoin_${wallet.id}_${coin.id}`,
                },
                { text: "📈 Dexscreener", url: `https://dexscreener.com/aptos/${coin.address}` },
            ],
            [
                {
                    text: `💳 ${textOverflow(wallet.address, 5)}`,
                    callback_data: `wallet_${wallet.id}`,
                },
                {
                    text: `📍 Positions`,
                    callback_data: `positions_${wallet.id}`,
                },
            ],
            [
                { text: "Buy 1 APT", callback_data: `buy_${wallet.id}_${coin.id}_1` },
                { text: "Buy 5 APT", callback_data: `buy_${wallet.id}_${coin.id}_5` },
                { text: "Buy 10 APT", callback_data: `buy_${wallet.id}_${coin.id}_10` },
            ],
            [
                { text: "Buy 20 APT", callback_data: `buy_${wallet.id}_${coin.id}_20` },
                { text: "Buy 50 APT", callback_data: `buy_${wallet.id}_${coin.id}_50` },
            ],
            [
                { text: "Buy 100 APT", callback_data: `buy_${wallet.id}_${coin.id}_1000` },
                { text: "Buy Custom", callback_data: `buy_${wallet.id}_${coin.id}_custom` },
            ],
            [
                { text: "Sell 25%", callback_data: `sell_${wallet.id}_${coin.id}_25` },
                { text: "Sell 50%", callback_data: `sell_${wallet.id}_${coin.id}_50` },
                { text: "Sell 75%", callback_data: `sell_${wallet.id}_${coin.id}_75` },
                { text: "Sell 100%", callback_data: `sell_${wallet.id}_${coin.id}_100` },
            ],
            [{ text: "⬅️ Back", callback_data: "back_to_menu" }],
        ],
    };
}

bot.launch();
console.log("Telegram bot is running...");
