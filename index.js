import express from 'express';
import 'dotenv/config'
const app = express();
const PORT = process.env.PORT || 5000;

//middle were
app.use(cors())
app.use(express.json())

const client = new `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fcgr75i.mongodb.net/`;

app.get('/', (req,res)=>{
res.send('hello world')
})


app.get('/books',(req,res)=>{
    res.send('fetchng users...')
})

app.listen(PORT,()=>{
    console.log(`Server is running on port ${PORT}`)
})