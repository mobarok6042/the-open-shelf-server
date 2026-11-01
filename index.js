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
    await client.connect();
    console.log("succesfully connected to mongodb");
    return client;
}

const connectedClient = await connectToMongoDB();
const db = connectedClient.db('test');
const books = db.collection('books');

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function availableCopyFilter() {
    return {
        $or: [
            { BorrowedByEmail: { $exists: false } },
            { BorrowedByEmail: null },
            { BorrowedByEmail: '' },
        ],
    };
}

app.get('/', (req, res) => {
    res.send('hello world')
})



app.get('/books', async(req, res) => {
    try {
        const allBooks = await books.find().toArray();
        return res.send(allBooks);
    } catch (err) {
        console.error('Failed to load books:', err);
        return res.status(500).json({ message: 'Failed to load books' });
    }
})

app.get('/books/new-arrivals', async (req, res) => {
    try {
        const latestBooks = await books
            .find()
            .sort({ _id: -1 })
            .limit(6)
            .toArray();
        return res.json(latestBooks);
    } catch (err) {
        console.error('Failed to load new arrivals:', err);
        return res.status(500).json({ message: 'Failed to load new arrivals' });
    }
})

app.get('/borrows', async (req, res) => {
    const email = typeof req.query.email === 'string'
        ? req.query.email.trim().toLowerCase()
        : '';

    if (!email) {
        return res.status(400).json({ message: 'A borrower email is required' });
    }

    try {
        const borrowedBooks = await books.find({ BorrowedByEmail: email }).toArray();
        return res.json(borrowedBooks);
    } catch (err) {
        console.error('Failed to load borrowed books:', err);
        return res.status(500).json({ message: 'Failed to load borrowed books' });
    }
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
            Email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' },
            ...availableCopyFilter(),
        });

        if (result.deletedCount === 0) {
            const existingBook = await books.findOne({ _id: new ObjectId(id) });
            if (existingBook?.BorrowedByEmail) {
                return res.status(409).json({ message: 'This copy cannot be removed while it is borrowed' });
            }
            return res.status(404).json({ message: 'Book not found or not owned by this user' });
        }

        return res.status(200).json({ message: 'Book removed successfully' });
    } catch (err) {
        console.error('Failed to remove book:', err);
        return res.status(500).json({ message: 'Failed to remove book' });
    }
})

app.post('/books/:id/borrow', async (req, res) => {
    const { id } = req.params;
    const email = typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
    const name = typeof req.body?.name === 'string'
        ? req.body.name.trim()
        : '';

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'A valid book ID is required' });
    }
    if (!email || !name) {
        return res.status(400).json({ message: 'Borrower name and email are required' });
    }

    try {
        const selectedBook = await books.findOne({ _id: new ObjectId(id) });
        if (!selectedBook) {
            return res.status(404).json({ message: 'Book not found' });
        }

        const titlePattern = `^${escapeRegex(String(selectedBook.Title).trim())}$`;
        const authorPattern = `^${escapeRegex(String(selectedBook.Author).trim())}$`;
        const borrowedBook = await books.findOneAndUpdate(
            {
                Title: { $regex: titlePattern, $options: 'i' },
                Author: { $regex: authorPattern, $options: 'i' },
                ...availableCopyFilter(),
            },
            {
                $set: {
                    BorrowedByEmail: email,
                    BorrowedByName: name,
                    BorrowedAt: new Date().toISOString(),
                },
            },
            { returnDocument: 'after' },
        );

        if (!borrowedBook) {
            return res.status(409).json({ message: 'No copies of this book are currently available' });
        }

        return res.status(200).json({ message: 'Book borrowed successfully', book: borrowedBook });
    } catch (err) {
        console.error('Failed to borrow book:', err);
        return res.status(500).json({ message: 'Failed to borrow book' });
    }
})

app.post('/borrows/:id/return', async (req, res) => {
    const { id } = req.params;
    const email = typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'A valid book ID is required' });
    }
    if (!email) {
        return res.status(400).json({ message: 'A borrower email is required' });
    }

    try {
        const result = await books.updateOne(
            { _id: new ObjectId(id), BorrowedByEmail: email },
            {
                $unset: {
                    BorrowedByEmail: '',
                    BorrowedByName: '',
                    BorrowedAt: '',
                },
            },
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ message: 'Borrowed copy not found for this user' });
        }

        return res.status(200).json({ message: 'Book returned successfully' });
    } catch (err) {
        console.error('Failed to return book:', err);
        return res.status(500).json({ message: 'Failed to return book' });
    }
})

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})