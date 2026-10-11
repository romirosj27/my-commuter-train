import { scrapeTrainData } from "../../../lib/mongo/trains";

export default async function handler(req, res) {
    if (req.method === 'GET') {
        const { from, to, atoc } = req.query;

        if (!from || !to || !atoc) {
            return res.status(400).json({ error: 'Missing from, to, or atoc parameters' });
        }

        const result = await scrapeTrainData(from, to, atoc);

        if (result.error) {
            res.status(500).json({ error: result.error });
        } else {
            res.status(200).json({
                message: `Successfully added ${result.insertedCount} trains.`,
            });
        }
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
}
