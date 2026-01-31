export async function getBtcPrice(): Promise<number> {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data.bitcoin.usd;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to fetch BTC price: ${error.message}`);
        }
        throw new Error('Failed to fetch BTC price: Unknown error');
    }
}