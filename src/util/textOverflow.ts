export function textOverflow(text: string, length: number): string {
    if (text.length > length * 2) {
        return text.substring(0, length) + "..." + text.substring(text.length - length);
    }

    return text;
}
