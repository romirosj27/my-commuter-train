import { compareTrainTimes } from "../../../lib/mongo/trains";


export default async function handler(req, res) {
    if (req.method === 'GET') {
        const result = await compareTrainTimes();

        if (result.error) {
            res.status(500).json({ error: result.error });
        } else {
            res.status(200).json({
                message: `Successfully sent email!`,
            });
        }
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
}