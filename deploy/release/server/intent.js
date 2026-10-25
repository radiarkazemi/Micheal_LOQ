/** Parse spoken/typed Persian+EN into session fields so we choose together. */
export function extractSessionPatch(text) {
    const raw = text.trim();
    if (!raw)
        return null;
    const q = raw.toLowerCase();
    const patch = {};
    // Note: JS \\b is ASCII-only — do not use \\b around Persian words
    if (/(xauusd|انس|طلای\s*جهانی|طلا|gold)/i.test(raw))
        patch.symbol = "XAUUSD";
    else if (/(eurusd|یورو\s*دلار|یورودلار|یورو)/i.test(raw))
        patch.symbol = "EURUSD";
    else if (/(gbpusd|پوند\s*دلار|پوند)/i.test(raw))
        patch.symbol = "GBPUSD";
    else if (/(usdjpy|دلار\s*ین)/i.test(raw))
        patch.symbol = "USDJPY";
    else if (/(btc|بیت\s*کوین|bitcoin)/i.test(raw))
        patch.symbol = "BTCUSD";
    else if (/(eth|اتریوم|ethereum)/i.test(raw))
        patch.symbol = "ETHUSD";
    else {
        const ticker = raw.match(/\b([A-Z]{6}|[A-Z]{3}USD|XAU[A-Z]{3})\b/i);
        if (ticker?.[1])
            patch.symbol = ticker[1].toUpperCase();
    }
    if (/(تایم\s*فریم\s*)?(یک|1)\s*(دقیقه)?/i.test(q) || /\b1\s*m\b/i.test(q))
        patch.timeframe = "1";
    else if (/(تایم\s*فریم\s*)?(پنج|5)\s*(دقیقه)?/i.test(q) || /\b5\s*m\b/i.test(q))
        patch.timeframe = "5";
    else if (/(تایم\s*فریم\s*)?(پانزده|پونزده|15)\s*(دقیقه)?/i.test(q) || /\b15\s*m\b/i.test(q)) {
        patch.timeframe = "15";
    }
    else if (/(تایم\s*فریم\s*)?(شصت|۶۰|60|یک\s*ساعت)/i.test(q) || /\b60\s*m\b/i.test(q)) {
        patch.timeframe = "60";
    }
    else if (/(تایم\s*فریم\s*)?(۲۴۰|240|چهار\s*ساعت|4h)/i.test(q))
        patch.timeframe = "240";
    else if (/(تایم\s*فریم\s*)?(روزانه|daily|\bD\b)/i.test(raw))
        patch.timeframe = "D";
    if (/(بایاس\s*)?(لانگ|long|خرید)/i.test(q))
        patch.bias = "long";
    else if (/(بایاس\s*)?(شورت|short|فروش)/i.test(q))
        patch.bias = "short";
    else if (/(بایاس\s*)?(فلت|flat|خنثی)/i.test(q))
        patch.bias = "flat";
    return Object.keys(patch).length ? patch : null;
}
