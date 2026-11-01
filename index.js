import express from 'express';
import 'dotenv/config'
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
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

app.post('/books', async (req, res) => {
    const newBook = req.body;

    if (!newBook || typeof newBook !== 'object' || Array.isArray(newBook)) {
        return res.status(400).json({ message: 'A book object is required' });
    }

    try {
        const result = await books.insertOne(newBook);
        res.status(201).json({ insertedId: result.insertedId });
    } catch (err) {
        console.error('Failed to add book:', err);
        res.status(500).json({ message: 'Failed to add book' });
    }
})

app.delete('/books/:id', async (req, res) => {
    const { id } = req.params;
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'A valid book ID is required' });
    }

    if (!email) {
        return res.status(400).json({ message: 'An owner email is required' });
    }

    try {
        const result = await books.deleteOne({
            _id: new ObjectId(id),
            Email: email,
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Book not found or not owned by this user' });
        }

        return res.status(200).json({ message: 'Book removed successfully' });
    } catch (err) {
        console.error('Failed to remove book:', err);
        return res.status(500).json({ message: 'Failed to remove book' });
    }
})

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})