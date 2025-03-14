import clientPromise from ".";

let client;
let db;
let trains;

async function init() {
    if (db) return; // If the database is already initialized, return early
    try {
        client = await clientPromise; // Initialize the MongoDB client
        db = await client.db('data'); // Connect to the database
        trains = await db.collection('trains'); // Get the trains collection
    } catch (error) {
        throw new Error('Failed to establish connection to database');
    }
}

export async function getTrains() {
    try {
        // Initialize the database connection if it's not already initialized
        if (!trains) await init();

        // Fetch the train data from the 'trains' collection
        const result = await trains
            .find({})
            .limit(20) // Limit the results to 20 entries
            .toArray();

        // Map the result to include '_id' as a string
        const trainsData = result.map(train => ({
            ...train,
            _id: train._id.toString(), // Convert the MongoDB ObjectId to a string
        }));

        return { trains: trainsData }; // Return the formatted result
    } catch (error) {
        return { error };
    }
}

export async function addTrain(newTrain) {
    try {
        if (!trains) await init();

        const result = await trains.insertOne(newTrain);

        return { train: result.ops ? result.ops[0] : newTrain };
    } catch (error) {
        return { error: 'Failed to add train data!' };
    }
}

export async function scrapeTrainData() {
    try {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are zero-indexed
        const day = String(today.getDate()).padStart(2, '0');
        const hours = String(today.getHours()).padStart(2, '0');
        const minutes = String(today.getMinutes()).padStart(2, '0');
        const url = `https://api.rtt.io/api/v1/json/search/NCL/to/YRK/${year}/${month}/${day}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Basic ${Buffer.from(
                    `${process.env.RTT_USERNAME}:${process.env.RTT_PASSWORD}`
                ).toString('base64')}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch train data: ${response.statusText}`);
        }

        const data = await response.json();
        const trainData  = data.services.filter(service => service.atocCode === 'TP' && service.serviceType === 'train'); // Only select trains

        if (!trains) await init();

        // Insert only unique trains based on `serviceUid`, `trainIdentity`, and `runDate`
        const uniqueTrains = [];
        for (let train of trainData ) {
            // Check if a train with the same serviceUid, trainIdentity, and runDate already exists in the DB
            const existingTrain = await trains.findOne({
                serviceUid: train.serviceUid,
                trainIdentity: train.trainIdentity,
                runDate: train.runDate,
            });

            if (existingTrain) {
                return { error: 'Train information already exists in the database!' };
            }

            uniqueTrains.push(train); // Only add train if it's not already in the DB
        }

        if (uniqueTrains.length > 0) {
            await trains.insertMany(uniqueTrains);
        }

        return { success: true, insertedCount: uniqueTrains.length };
    } catch (error) {
        return { error: error.message };
    }
}
