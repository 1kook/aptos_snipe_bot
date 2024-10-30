const subscriptMap: Record<string, string> = {
    "1": "₁",
    "2": "₂",
    "3": "₃",
    "4": "₄",
    "5": "₅",
    "6": "₆",
    "7": "₇",
    "8": "₈",
    "9": "₉",
};

export function cryptoAmountRound(amount: string | number): string {
    const [whole, decimal] = amount.toString().split(".");

    // Return early if no decimal part
    if (!decimal) {
        return amount.toString();
    }

    // Find first 4 significant digits after decimal
    let significantDigits = "";
    let significantCount = 0;
    let leadingZeros = 0;
    let countingZeros = true;

    for (const digit of decimal) {
        significantDigits += digit;

        if (digit === "0" && countingZeros) {
            leadingZeros++;
        } else {
            countingZeros = false;
            significantCount++;
        }

        if (significantCount === 5) break;
    }

    // Format the decimal part
    let formattedDecimal = significantDigits;
    if (leadingZeros > 2) {
        const subscript = leadingZeros
            .toString()
            .split("")
            .map((digit) => subscriptMap[digit] || digit)
            .join("");
        formattedDecimal = `0${subscript}${significantDigits.slice(leadingZeros)}`;
    }

    return `${whole}.${formattedDecimal}`;
}

export function marketCapRound(marketCap: number, prefix = ""): string {
    // Convert to string and split on decimal point, take the integer part
    const marketCapStr = Math.floor(marketCap).toString();
    const numLen = marketCapStr.length;

    if (numLen < 4) {
        return `Under ${prefix}1K`;
    } else if (numLen < 7) {
        return `${prefix}${(marketCap / 1000).toFixed(1)}K`;
    } else if (numLen < 10) {
        return `${prefix}${(marketCap / 1000000).toFixed(1)}M`;
    } else if (numLen < 13) {
        return `${prefix}${(marketCap / 1000000000).toFixed(1)}B`;
    } else if (numLen < 16) {
        return `${prefix}${(marketCap / 1000000000000).toFixed(1)}T`;
    } else {
        return `${prefix}${marketCapStr.slice(0, -15)}Q`;
    }
}
