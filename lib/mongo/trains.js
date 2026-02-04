import clientPromise from ".";
import nodemailer from 'nodemailer';

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
            // .limit(20) // Limit the results to 20 entries
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

export async function scrapeTrainData(from, to, atoc) {
    try {
        if (!from || !to) {
            throw new Error('Both departure and arrival station codes are required.');
        }

        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const formatDate = (date) =>
            `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;

        const urls = [
            `https://api.rtt.io/api/v1/json/search/${from}/to/${to}/2026/02/05`,
            `https://api.rtt.io/api/v1/json/search/${to}/to/${from}/2026/02/05`,
            `https://api.rtt.io/api/v1/json/search/${from}/to/${to}/2026/02/06`,
            `https://api.rtt.io/api/v1/json/search/${to}/to/${from}/2026/02/06`,
        ];

        const trainData = [];

        for (const url of urls) {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    Authorization: `Basic ${Buffer.from(
                        `${process.env.RTT_USERNAME}:${process.env.RTT_PASSWORD}`
                    ).toString('base64')}`,
                },
            });

            if (!response.ok) {
                console.error(`Failed to fetch from ${url}: ${response.statusText}`);
                continue; // Skip to next URL
            }

            const data = await response.json();
            
            const filteredTrains = data.services.filter(
                (service) => service.atocCode === atoc && service.serviceType === 'train'
            );
            trainData.push(...filteredTrains);
            
        }

        if (!trains) await init();

        const uniqueTrains = [];
        for (const train of trainData) {
            const exists = await trains.findOne({
                serviceUid: train.serviceUid,
                trainIdentity: train.trainIdentity,
                runDate: train.runDate,
            });

            if (!exists) {
                uniqueTrains.push(train);
            }
        }

        if (uniqueTrains.length > 0) {
            await trains.insertMany(uniqueTrains);
        }

        return { success: true, insertedCount: uniqueTrains.length };
    } catch (error) {
        return { error: error.message };
    }
}


// Function to compare train departure times
export async function compareTrainTimes() {
    try {
        if (!trains) await init();

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        const formatDate = (date) =>
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        // Fetch today's train data from the API
        const todayUrl = `https://api.rtt.io/api/v1/json/search/NCL/to/YRK/${formatDate(today)}`;
        // TODO: Change this date to use the current date
        // const todayUrl = `https://api.rtt.io/api/v1/json/search/NCL/to/YRK/2025/03/29/0700`;

        const response = await fetch(todayUrl, {
            method: 'GET',
            headers: {
                Authorization: `Basic ${Buffer.from(
                    `${process.env.RTT_USERNAME}:${process.env.RTT_PASSWORD}`
                ).toString('base64')}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch today's train data: ${response.statusText}`);
        }

        const data = await response.json();

        // Find the relevant train for today based on route and identifiers
        const todayTrain = data.services.find(
            (service) =>
                service.atocCode === 'TP' &&
                service.serviceType === 'train' 
                // service.trainIdentity === '9M08'
        );

        if (!todayTrain) {
            await sendNotification(`❌ Cancellation Alert: Today's train from Newcastle to York has been canceled.`);
            return { success: true, message: "Today's train was canceled." };
        }

        // Fetch yesterday's train data from MongoDB
        const yesterdayTrain = await trains.findOne({
            //TODO: update this to use yesterdays date
            runDate: formatDate(today-1),
            // trainIdentity:'9M08',
        });

        if (!yesterdayTrain) {
            return { error: 'No matching train found for yesterday.' };
        }

        const todayTime = todayTrain.locationDetail.gbttBookedDeparture;
        const yesterdayTime = yesterdayTrain.locationDetail.gbttBookedDeparture;

        const todayPlatform = todayTrain.locationDetail.platform;
        const yesterdayPlatform = yesterdayTrain.locationDetail.platform;

        let message = '';

        if (todayTime !== yesterdayTime) {
            
            message += `Train time change alert! \n\nToday's train leaves at ${todayTime}, different from yesterday's departure at ${yesterdayTime}.`
            
        }

        if (todayPlatform !== yesterdayPlatform) {
            message += `\n Platform Change: Today's platform is ${todayPlatform}, different from yesterday's at ${yesterdayPlatform}.\n`;
        }

        if (message) {
            await sendNotification(message.trim());
        } else {
            return { success: true, message: 'No changes in time or platform detected.' };
        }

        return { success: true, message: 'Train times compared successfully.' };
    } catch (error) {
        return { error: error.message };
    }
}

// Function to send a notification (via email)
async function sendNotification(message) {
    const transporter = nodemailer.createTransport({
        service: 'Gmail',
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
            user: process.env.NOTIFY_EMAIL,
            pass: process.env.NOTIFY_PASSWORD
        }
    });

    await transporter.sendMail({
        from: '"MyCommuterTrain" optimisticsteve122@gmail.com',
        to: 'johnson.romiro@yahoo.com', // Your recipient
        subject: '🚨 Commuter Train Alert 🚨',
        text: message
    });
}