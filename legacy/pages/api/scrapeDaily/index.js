import { scrapeTrainData } from "../../../lib/mongo/trains";

function getNextWeekday() {
    const now = new Date();
    const day = now.getDay();
    
    // If it's Friday (5) or Saturday (6), jump to Monday
    if (day === 5) now.setDate(now.getDate() + 3); 
    else if (day === 6) now.setDate(now.getDate() + 2);
    else now.setDate(now.getDate() + 1);

    const formattedDate = now.toISOString().split('T')[0]; // e.g., "2025-03-18"
    return formattedDate;
}

export default async function handler(req, res) {
    const date = getNextWeekday();
    
    const result = await scrapeTrainData(`https://api.rtt.io/api/v1/json/search/NCL/to/YRK/${date}/0700`);

    if (result.error) {
        res.status(500).json({ error: result.error });
    } else {
        res.status(200).json({
            message: `Successfully added ${result.insertedCount} TPE trains for ${date}.`,
        });
    }
}