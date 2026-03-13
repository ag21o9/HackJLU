import express from 'express';
import userRouter from './routes/user.route.js';
import exchangeRouter from './routes/exchange.route.js';
const app = express();
app.use(express.json());
app.use('/user', userRouter);
app.use('/api', exchangeRouter);
app.get('/', (req, res) => {
    res.json({
        "message": "solana is great"
    });
});
app.listen(3000, () => {
    console.log('App is listening on port 3000');
});
//# sourceMappingURL=index.js.map