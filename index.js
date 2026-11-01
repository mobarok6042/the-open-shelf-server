import express from 'express';
import 'dotenv/config'
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { MongoClient, ObjectId } from 'mongodb';
const app = express();
const PORT = process.env.PORT || 5000;

const isProduction = process.env.NODE_ENV === 'production';
const configuredOrigins = process.env.CLIENT_ORIGINS
    || (isProduction ? '' : 'http://localhost:3000');
const allowedOrigins = new Set(
    configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean),
);

if (allowedOrigins.size === 0) {
    throw new Error('Set CLIENT_ORIGINS to the frontend origin(s) before starting in production');
}

const authBaseUrl = process.env.AUTH_BASE_URL
    || (isProduction ? '' : 'http://localhost:3000');
if (!authBaseUrl) {
    throw new Error('Set AUTH_BASE_URL to the Better Auth base URL before starting in production');
}

const authOrigin = new URL(authBaseUrl).origin;
const jwks = createRemoteJWKSet(new URL('/api/auth/jwks', authOrigin));

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
    origin(origin, callback) {
        callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: true,
}));
app.use(express.json({ limit: '10kb' }));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
}));

function requireAuth(req, res, next) {
    const authorization = req.get('authorization');
    const token = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : '';

    if (!token) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        return res.status(401).json({ message: 'A valid bearer token is required' });
    }

    jwtVerify(token, jwks, {
        issuer: authOrigin,
        audience: authOrigin,
    }).then(({ payload }) => {
        if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
            res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
            return res.status(401).json({ message: 'The bearer token has invalid user claims' });
        }

        req.auth = {
            id: payload.sub,
            email: payload.email.trim().toLowerCase(),
            name: typeof payload.name === 'string' && payload.name.trim()
                ? payload.name.trim()
                : payload.email.trim(),
        };
        return next();
    }).catch((err) => {
        if (err instanceof errors.JOSEError) {
            res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
            return res.status(401).json({ message: 'The bearer token is invalid or expired' });
        }

        console.error('Could not verify bearer token:', err);
        return res.status(503).json({ message: 'Authentication service is unavailable' });
    });
}

const uri = `mongodb+srv://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASS)}@cluster0.fcgr75i.mongodb.net/`;
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

function redactBook(book) {
    const {
        Email,
        UserName,
        BorrowedByEmail,
        BorrowedByName,
        BorrowedAt,
        ...publicBook
    } = book;
    return {
        ...publicBook,
        BorrowedByEmail: typeof BorrowedByEmail === 'string' && BorrowedByEmail
            ? 'borrowed'
            : '',
    };
}

function validateBook(input) {
    const title = typeof input.Title === 'string' ? input.Title.trim() : '';
    const author = typeof input.Author === 'string' ? input.Author.trim() : '';
    const category = typeof input.Category === 'string' ? input.Category.trim() : '';
    const details = typeof input.Details === 'string' ? input.Details.trim() : '';
    const imageLink = typeof input['Image-link'] === 'string'
        ? input['Image-link'].trim()
        : '';
    const categories = new Set(['Fiction', 'Science', 'History', 'Kids', 'Novel', 'Others']);

    if (!title || title.length > 200 || !author || author.length > 200) {
        return { error: 'Title and author are required and must be 200 characters or fewer' };
    }
    if (!categories.has(category)) {
        return { error: 'A valid book category is required' };
    }
    if (details.length > 5000 || imageLink.length > 2048) {
        return { error: 'Book details or image URL exceed the allowed length' };
    }

    try {
        if (new URL(imageLink).protocol !== 'https:') {
            return { error: 'The book cover must use an HTTPS URL' };
        }
    } catch {
        return { error: 'A valid HTTPS book cover URL is required' };
    }

    return {
        book: {
            Title: title,
            Author: author,
            Category: category,
            'Image-link': imageLink,
            Details: details,
        },
    };
}

app.get('/', (req, res) => {
    res.send('hello world')
})



app.get('/books', async(req, res) => {
    try {
        const allBooks = (await books.find().toArray()).map(redactBook);
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
        return res.json(latestBooks.map(redactBook));
    } catch (err) {
        console.error('Failed to load new arrivals:', err);
        return res.status(500).json({ message: 'Failed to load new arrivals' });
    }
})

app.get('/borrows', requireAuth, async (req, res) => {
    try {
        const borrowedBooks = await books.find({ BorrowedByEmail: req.auth.email }).toArray();
        return res.json(borrowedBooks);
    } catch (err) {
        console.error('Failed to load borrowed books:', err);
        return res.status(500).json({ message: 'Failed to load borrowed books' });
    }
})

app.get('/my-books', requireAuth, async (req, res) => {
    try {
        const ownedBooks = await books.find({
            Email: { $regex: `^${escapeRegex(req.auth.email)}$`, $options: 'i' },
        }).toArray();
        return res.json(ownedBooks.map(redactBook));
    } catch (err) {
        console.error('Failed to load your books:', err);
        return res.status(500).json({ message: 'Failed to load your books' });
    }
})

app.post('/books', requireAuth, async (req, res) => {
    const newBook = req.body;

    if (!newBook || typeof newBook !== 'object' || Array.isArray(newBook)) {
        return res.status(400).json({ message: 'A book object is required' });
    }

    const validated = validateBook(newBook);
    if (validated.error) {
        return res.status(400).json({ message: validated.error });
    }

    try {
        const result = await books.insertOne({
            ...validated.book,
            UserName: req.auth.name,
            Email: req.auth.email,
        });
        res.status(201).json({ insertedId: result.insertedId });
    } catch (err) {
        console.error('Failed to add book:', err);
        res.status(500).json({ message: 'Failed to add book' });
    }
})

app.delete('/books/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'A valid book ID is required' });
    }

    try {
        const result = await books.deleteOne({
            _id: new ObjectId(id),
            Email: { $regex: `^${escapeRegex(req.auth.email)}$`, $options: 'i' },
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

app.post('/books/:id/borrow', requireAuth, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'A valid book ID is required' });
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
                    BorrowedByEmail: req.auth.email,
                    BorrowedByName: req.auth.name,
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

app.post('/borrows/:id/return', requireAuth, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'A valid book ID is required' });
    }
    try {
        const result = await books.updateOne(
            { _id: new ObjectId(id), BorrowedByEmail: req.auth.email },
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