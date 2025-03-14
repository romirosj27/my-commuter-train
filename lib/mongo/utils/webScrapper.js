import clientPromise from '../../lib/mongodb';

export default async function handler(req, res) {
    const username = process.env.RTT_USERNAME;
    const password = process.env.RTT_PASSWORD;
    const endpoint = 'https://api.rtt.io/api/v1/json/search/NCL/to/YRK/2025/03/17/0700';

    const headers = new Headers({
        'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
        'Accept-Encoding': 'gzip',
        'Content-Type': 'application/json'
    });

    try {
        const response = await fetch(endpoint, { method: 'GET', headers });
        if (!response.ok) {
            throw new Error(`Error ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Filter for Transpennine Express services only
        const filteredTrains = data.services?.filter(service => 
            service.atocCode === 'TP'
        ).map(service => ({
            serviceUid: service.serviceUid,
            runDate: service.runDate,
            departureTime: service.locationDetail?.gbttBookedDeparture,
            arrivalTime: service.locationDetail?.gbttBookedArrival || 'N/A',
            origin: service.locationDetail?.origin[0]?.description,
            destination: service.locationDetail?.destination[0]?.description,
            platform: service.locationDetail?.platform || 'N/A'
        }));

        // MongoDB insertion
        const client = await clientPromise;
        const db = client.db("trainData");
        const collection = db.collection("transpennineServices");

        await collection.insertMany(filteredTrains);

        res.status(200).json({ message: 'Data successfully added to MongoDB', data: filteredTrains });
    } catch (error) {
        console.error('Failed to fetch or insert data:', error.message);
        res.status(500).json({ error: 'Failed to fetch or insert data' });
    }
}
