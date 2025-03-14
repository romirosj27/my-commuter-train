import { getTrains, addTrain } from "../../../lib/mongo/trains";

const handler = async (req, res) => {
    if(req.method == 'GET'){
        try {
            const {trains,error} = await getTrains()
            if (error) throw new Error(error)
            
            return res.status(200).json({trains})

        } catch (error) {
            return res.status(500).json({error:error.message})
        }
    }

    if (req.method === 'POST') {
        try {
            const { trainNumber, departureTime, platform, status, date, departureCity, arrivalCity, stations } = req.body;

            // Basic validation
            if (!trainNumber || !departureTime || !departureCity || !arrivalCity) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const newTrain = {
                trainNumber,
                departureTime,
                platform,
                status,
                date,
                departureCity,
                arrivalCity,
                stations,
            };

            const { train, error } = await addTrain(newTrain);
            if (error) throw new Error(error);

            return res.status(201).json({ message: 'Train added successfully', train });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    res.setHeader('Allow', ['GET'])

    res.status(425).end(`Method ${req.method} is not allowed.`)
}

export default handler