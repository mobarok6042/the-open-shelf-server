import express from 'express';
import 'dotenv/config'
import cors from 'cors';
import { MongoClient } from 'mongodb';
const app = express();
const PORT = process.env.PORT || 5000;

//middle were
app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fcgr75i.mongodb.net/`;
const client = new MongoClient(uri);


export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("succesfully connected to mongodb");
        return client;
    }
    catch (err) {
        console.dir(err)
    }
}

const connectedClient = await connectToMongoDB();
const db = connectedClient.db('test');
const books = db.collection('books');

app.get('/', (req, res) => {
    res.send('hello world')
})



app.get('/books', async(req, res) => {
    const cursor = books.find();
    const allBooks = await cursor.toArray();
    res.send(allBooks);
})

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})