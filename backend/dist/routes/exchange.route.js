import { Router } from 'express';
import jwt from 'jsonwebtoken';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl, sendAndConfirmTransaction, } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, MINT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, createInitializeMintInstruction, createMintToInstruction, createTransferInstruction, getAssociatedTokenAddress, getMinimumBalanceForRentExemptMint, } from '@solana/spl-token';
import { Prisma, PredictionSide } from '../generated/prisma/client.js';
import { prisma } from '../prisma.config.js';
import { uploadFile } from '../config/imageKit.config.js';
const exchangeRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'hello world';
const AUTH_MESSAGE = process.env.AUTH_SIGN_MESSAGE ?? 'Sign into mechanical turks';
function getUserIdFromAuthHeader(authHeader) {
    if (!authHeader?.startsWith('Bearer '))
        return null;
    const token = authHeader.split(' ')[1];
    if (!token)
        return null;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (typeof decoded === 'string')
            return null;
        return typeof decoded.userId === 'string' ? decoded.userId : null;
    }
    catch {
        return null;
    }
}
async function getUserFromAuthHeader(authHeader) {
    const userId = getUserIdFromAuthHeader(authHeader);
    if (!userId)
        return null;
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, walletAddress: true },
    });
    if (!user)
        return null;
    return user;
}
function normalizeSignature(input) {
    if (!input)
        return null;
    if (Array.isArray(input))
        return new Uint8Array(input);
    if (typeof input === 'string') {
        try {
            return new Uint8Array(Buffer.from(input, 'base64'));
        }
        catch {
            return null;
        }
    }
    if (typeof input === 'object') {
        const obj = input;
        if (Array.isArray(obj.data)) {
            return new Uint8Array(obj.data);
        }
        const numericKeys = Object.keys(obj).filter((k) => /^\d+$/.test(k));
        if (numericKeys.length > 0) {
            const arr = numericKeys
                .sort((a, b) => Number(a) - Number(b))
                .map((k) => Number(obj[k]));
            return new Uint8Array(arr);
        }
    }
    return null;
}
function parseWalletAddress(value) {
    if (typeof value !== 'string' || !value.trim())
        return null;
    try {
        const wallet = new PublicKey(value.trim());
        return wallet.toBase58();
    }
    catch {
        return null;
    }
}
function isAdminRequest(req, userWallet) {
    const adminApiKey = process.env.ADMIN_API_KEY;
    const headerKey = typeof req.headers['x-admin-key'] === 'string' ? req.headers['x-admin-key'] : '';
    if (adminApiKey && headerKey && headerKey === adminApiKey)
        return true;
    if (!userWallet)
        return false;
    const adminWallets = (process.env.ADMIN_WALLETS ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return adminWallets.includes(userWallet);
}
function getSolanaConnection() {
    const rpcUrl = process.env.SOLANA_RPC_URL ?? clusterApiUrl('devnet');
    return new Connection(rpcUrl, 'confirmed');
}
function getPlatformSigner() {
    const secret = process.env.PLATFORM_SIGNER_SECRET;
    if (!secret) {
        throw new Error('Missing PLATFORM_SIGNER_SECRET env var');
    }
    try {
        if (secret.trim().startsWith('[')) {
            const parsed = JSON.parse(secret);
            if (!Array.isArray(parsed)) {
                throw new Error('PLATFORM_SIGNER_SECRET JSON must be a number array');
            }
            return Keypair.fromSecretKey(Uint8Array.from(parsed));
        }
        return Keypair.fromSecretKey(bs58.decode(secret.trim()));
    }
    catch (error) {
        throw new Error(`Invalid PLATFORM_SIGNER_SECRET format: ${error.message}`);
    }
}
async function mintAssetToken(params) {
    const connection = getSolanaConnection();
    const payer = getPlatformSigner();
    const owner = new PublicKey(params.ownerWallet);
    const mintKeypair = Keypair.generate();
    const lamportsForMint = await getMinimumBalanceForRentExemptMint(connection);
    const ownerTokenAccount = await getAssociatedTokenAddress(mintKeypair.publicKey, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const treasuryTokenAccount = await getAssociatedTokenAddress(mintKeypair.publicKey, payer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const tx = new Transaction().add(SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports: lamportsForMint,
        programId: TOKEN_PROGRAM_ID,
    }), createInitializeMintInstruction(mintKeypair.publicKey, 0, payer.publicKey, payer.publicKey, TOKEN_PROGRAM_ID), createAssociatedTokenAccountInstruction(payer.publicKey, ownerTokenAccount, owner, mintKeypair.publicKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID), createMintToInstruction(mintKeypair.publicKey, ownerTokenAccount, payer.publicKey, BigInt(params.totalSupply), [], TOKEN_PROGRAM_ID));
    const txSignature = await sendAndConfirmTransaction(connection, tx, [payer, mintKeypair], {
        commitment: 'confirmed',
    });
    return {
        mintAddress: mintKeypair.publicKey.toBase58(),
        treasuryPda: treasuryTokenAccount.toBase58(),
        txSignature,
    };
}
async function uploadAssetMetadata(params) {
    const metadata = {
        name: params.name,
        symbol: 'ESP-TEAM',
        description: `Esports team asset token for ${params.teamName ?? 'Unknown Team'}`,
        attributes: [
            { trait_type: 'team', value: params.teamName ?? 'N/A' },
            { trait_type: 'game', value: params.teamGame ?? 'N/A' },
            { trait_type: 'region', value: params.teamRegion ?? 'N/A' },
            { trait_type: 'base_price', value: params.basePrice },
            { trait_type: 'k_factor', value: params.kFactor },
        ],
    };
    try {
        const uploaded = await uploadFile(Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'), `${params.name.replace(/\s+/g, '-').toLowerCase()}-metadata.json`);
        return uploaded.url ?? null;
    }
    catch {
        return null;
    }
}
function toJsonSafe(value) {
    if (typeof value === 'bigint')
        return value.toString();
    if (value instanceof Date)
        return value.toISOString();
    if (Prisma.Decimal.isDecimal(value))
        return value.toString();
    if (Array.isArray(value)) {
        return value.map((item) => toJsonSafe(item));
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]);
        return Object.fromEntries(entries);
    }
    return value;
}
function requirePositiveNumber(value) {
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0)
        return null;
    return parsed;
}
function requirePositiveInt(value) {
    const parsed = requirePositiveNumber(value);
    if (!parsed)
        return null;
    return Math.trunc(parsed);
}
function priceAt(basePrice, kFactor, supply) {
    return basePrice + (kFactor * supply);
}
function buyCost(basePrice, kFactor, currentSupply, quantity) {
    return (quantity * basePrice) + (kFactor * ((quantity * currentSupply) + ((quantity * (quantity - 1)) / 2)));
}
function sellPayout(basePrice, kFactor, currentSupply, quantity) {
    return (quantity * basePrice) + (kFactor * ((quantity * (currentSupply - 1)) - ((quantity * (quantity - 1)) / 2)));
}
function marketSidePrice(basePrice, kFactor, sideSupply) {
    return basePrice + (kFactor * sideSupply);
}
function marketBuyCost(basePrice, kFactor, sideSupply, quantity) {
    return (quantity * basePrice) + (kFactor * ((quantity * sideSupply) + ((quantity * (quantity - 1)) / 2)));
}
function marketSellPayout(basePrice, kFactor, sideSupply, quantity) {
    return (quantity * basePrice) + (kFactor * ((quantity * (sideSupply - 1)) - ((quantity * (quantity - 1)) / 2)));
}
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
async function sendMemoTransaction(payload) {
    const connection = getSolanaConnection();
    const payer = getPlatformSigner();
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const memoIx = new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
        data: Buffer.from(JSON.stringify(payload), 'utf8'),
    });
    const tx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: blockhash,
    }).add(memoIx);
    return sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
}
async function getConfirmedTxMemo(signature) {
    const connection = getSolanaConnection();
    const parsed = await connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
    });
    if (!parsed || parsed.meta?.err)
        return null;
    const memoAddr = MEMO_PROGRAM_ID.toBase58();
    for (const ix of parsed.transaction.message.instructions) {
        if (ix.programId.toBase58() !== memoAddr)
            continue;
        if (!('data' in ix))
            continue;
        try {
            return JSON.parse(Buffer.from(bs58.decode(ix.data)).toString('utf8'));
        }
        catch {
            return null;
        }
    }
    return null;
}
exchangeRouter.post('/auth/wallet', async (req, res) => {
    try {
        const { walletAddress, signature } = req.body;
        const parsedWallet = parseWalletAddress(walletAddress);
        if (!parsedWallet) {
            return res.status(400).json({ message: 'Invalid walletAddress' });
        }
        const sigBytes = normalizeSignature(signature);
        if (!sigBytes || sigBytes.length !== 64) {
            return res.status(400).json({ message: 'Invalid signature format/size (expected 64 bytes)' });
        }
        const message = new TextEncoder().encode(AUTH_MESSAGE);
        const isValid = nacl.sign.detached.verify(message, sigBytes, new PublicKey(parsedWallet).toBytes());
        if (!isValid) {
            return res.status(401).json({ message: 'Incorrect signature' });
        }
        const existingUser = await prisma.user.findUnique({ where: { walletAddress: parsedWallet } });
        const user = existingUser ?? await prisma.user.create({ data: { walletAddress: parsedWallet } });
        const token = jwt.sign({ userId: user.id }, JWT_SECRET);
        return res.json({
            message: existingUser ? 'existing' : 'created',
            token,
            user: {
                id: user.id,
                walletAddress: user.walletAddress,
                username: user.username,
            },
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed wallet auth' });
    }
});
exchangeRouter.post('/admin/teams', async (req, res) => {
    try {
        const authUser = await getUserFromAuthHeader(req.headers.authorization);
        const authWallet = authUser?.walletAddress;
        if (!isAdminRequest({ headers: req.headers }, authWallet)) {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const { name, game, region, logoUrl } = req.body;
        if (typeof name !== 'string' || !name.trim() || typeof game !== 'string' || !game.trim()) {
            return res.status(400).json({ message: 'name and game are required' });
        }
        const team = await prisma.team.create({
            data: {
                name: name.trim(),
                game: game.trim(),
                region: typeof region === 'string' ? region.trim() : null,
                logoUrl: typeof logoUrl === 'string' ? logoUrl.trim() : null,
            },
        });
        return res.status(201).json({ message: 'Team created', team });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed to create team' });
    }
});
exchangeRouter.post('/admin/collections', async (req, res) => {
    try {
        const authUser = await getUserFromAuthHeader(req.headers.authorization);
        const authWallet = authUser?.walletAddress;
        if (!isAdminRequest({ headers: req.headers }, authWallet)) {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const { name, description, collectionMint, metadataUri } = req.body;
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ message: 'name is required' });
        }
        const collection = await prisma.assetCollection.create({
            data: {
                name: name.trim(),
                description: typeof description === 'string' ? description.trim() : null,
                collectionMint: typeof collectionMint === 'string' ? collectionMint.trim() : null,
                metadataUri: typeof metadataUri === 'string' ? metadataUri.trim() : null,
            },
        });
        return res.status(201).json({ message: 'Collection created', collection });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed to create collection' });
    }
});
exchangeRouter.post('/admin/assets/mint', async (req, res) => {
    try {
        const authUser = await getUserFromAuthHeader(req.headers.authorization);
        const authWallet = authUser?.walletAddress;
        if (!isAdminRequest({ headers: req.headers }, authWallet)) {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const { name, teamId, collectionId, totalSupply, basePrice, kFactor } = req.body;
        if (typeof name !== 'string' || !name.trim() || typeof teamId !== 'string' || !teamId.trim()) {
            return res.status(400).json({ message: 'name and teamId are required' });
        }
        const supply = requirePositiveInt(totalSupply);
        const parsedBasePrice = requirePositiveNumber(basePrice);
        const parsedKFactor = requirePositiveNumber(kFactor);
        if (!supply || !parsedBasePrice || !parsedKFactor) {
            return res.status(400).json({ message: 'totalSupply, basePrice, kFactor must be positive numbers' });
        }
        const [team, collection] = await Promise.all([
            prisma.team.findUnique({ where: { id: teamId.trim() } }),
            typeof collectionId === 'string' && collectionId.trim()
                ? prisma.assetCollection.findUnique({ where: { id: collectionId.trim() } })
                : Promise.resolve(null),
        ]);
        if (!team)
            return res.status(404).json({ message: 'Team not found' });
        if (collectionId && !collection)
            return res.status(404).json({ message: 'Collection not found' });
        const mintOwner = process.env.ADMIN_MINT_WALLET ?? getPlatformSigner().publicKey.toBase58();
        const { mintAddress, treasuryPda, txSignature } = await mintAssetToken({
            ownerWallet: mintOwner,
            totalSupply: supply,
        });
        const metadataUri = await uploadAssetMetadata({
            name: name.trim(),
            teamName: team.name,
            teamGame: team.game,
            basePrice: parsedBasePrice,
            kFactor: parsedKFactor,
            ...(team.region ? { teamRegion: team.region } : {}),
        });
        const asset = await prisma.asset.create({
            data: {
                name: name.trim(),
                assetType: 'TEAM',
                teamId: team.id,
                collectionId: collection?.id ?? null,
                mintAddress,
                metadataUri,
                basePrice: parsedBasePrice,
                currentPrice: priceAt(parsedBasePrice, parsedKFactor, 0),
                totalSupply: supply,
                circulating: 0,
                bondingCurveK: parsedKFactor,
            },
        });
        return res.status(201).json({
            message: 'Asset minted',
            asset,
            mint: {
                mintAddress,
                treasuryPda,
                txSignature,
            },
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message || 'Failed to mint asset' });
    }
});
exchangeRouter.post('/admin/matches', async (req, res) => {
    try {
        const authUser = await getUserFromAuthHeader(req.headers.authorization);
        const authWallet = authUser?.walletAddress;
        if (!isAdminRequest({ headers: req.headers }, authWallet)) {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const { teamAId, teamBId, tournament, startTime } = req.body;
        if (typeof teamAId !== 'string' || typeof teamBId !== 'string' || !teamAId.trim() || !teamBId.trim()) {
            return res.status(400).json({ message: 'teamAId and teamBId are required' });
        }
        if (teamAId === teamBId) {
            return res.status(400).json({ message: 'teamAId and teamBId must be different' });
        }
        const parsedStart = typeof startTime === 'string' ? new Date(startTime) : null;
        if (!parsedStart || Number.isNaN(parsedStart.getTime())) {
            return res.status(400).json({ message: 'startTime must be an ISO datetime' });
        }
        const [teamA, teamB] = await Promise.all([
            prisma.team.findUnique({ where: { id: teamAId.trim() } }),
            prisma.team.findUnique({ where: { id: teamBId.trim() } }),
        ]);
        if (!teamA || !teamB) {
            return res.status(404).json({ message: 'One or both teams not found' });
        }
        const match = await prisma.match.create({
            data: {
                teamAId: teamA.id,
                teamBId: teamB.id,
                tournament: typeof tournament === 'string' ? tournament.trim() : null,
                startTime: parsedStart,
                status: 'SCHEDULED',
            },
            include: {
                teamA: true,
                teamB: true,
            },
        });
        return res.status(201).json({ message: 'Match created', match });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed to create match' });
    }
});
exchangeRouter.post('/admin/markets', async (req, res) => {
    try {
        const authUser = await getUserFromAuthHeader(req.headers.authorization);
        const authWallet = authUser?.walletAddress;
        if (!isAdminRequest({ headers: req.headers }, authWallet)) {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const { matchId, basePrice, kFactor, initialLiquidity } = req.body;
        if (typeof matchId !== 'string' || !matchId.trim()) {
            return res.status(400).json({ message: 'matchId is required' });
        }
        const parsedBasePrice = requirePositiveNumber(basePrice);
        const parsedKFactor = requirePositiveNumber(kFactor);
        const parsedLiquidity = requirePositiveNumber(initialLiquidity);
        if (!parsedBasePrice || !parsedKFactor || !parsedLiquidity) {
            return res.status(400).json({ message: 'basePrice, kFactor, initialLiquidity must be positive numbers' });
        }
        const match = await prisma.match.findUnique({ where: { id: matchId.trim() } });
        if (!match)
            return res.status(404).json({ message: 'Match not found' });
        const existing = await prisma.predictionMarket.findUnique({ where: { matchId: match.id } });
        if (existing) {
            return res.status(400).json({ message: 'Market already exists for this match' });
        }
        const createMarketSig = await sendMemoTransaction({ op: 'create_market', matchId: match.id });
        const market = await prisma.predictionMarket.create({
            data: {
                matchId: match.id,
                contractAddr: createMarketSig,
                liquidityPool: parsedLiquidity,
                supplyA: 0,
                supplyB: 0,
                basePrice: parsedBasePrice,
                curveK: parsedKFactor,
                status: 'OPEN',
            },
            include: {
                match: {
                    include: {
                        teamA: true,
                        teamB: true,
                    },
                },
            },
        });
        return res.status(201).json({
            message: 'Market created',
            contractCall: {
                method: 'create_market',
                txSignature: createMarketSig,
            },
            market,
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed to create market' });
    }
});
exchangeRouter.post('/admin/markets/liquidity', async (req, res) => {
    try {
        const authUser = await getUserFromAuthHeader(req.headers.authorization);
        const authWallet = authUser?.walletAddress;
        if (!isAdminRequest({ headers: req.headers }, authWallet)) {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const { marketId, amount } = req.body;
        if (typeof marketId !== 'string' || !marketId.trim()) {
            return res.status(400).json({ message: 'marketId is required' });
        }
        const parsedAmount = requirePositiveNumber(amount);
        if (!parsedAmount) {
            return res.status(400).json({ message: 'amount must be a positive number' });
        }
        const market = await prisma.predictionMarket.update({
            where: { id: marketId.trim() },
            data: {
                liquidityPool: { increment: parsedAmount },
            },
        });
        const addLiquiditySig = await sendMemoTransaction({ op: 'add_liquidity', marketId: market.id, amount: parsedAmount });
        return res.json({
            message: 'Liquidity added',
            contractCall: {
                method: 'add_liquidity',
                txSignature: addLiquiditySig,
            },
            market,
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed to add liquidity' });
    }
});
exchangeRouter.post('/admin/matches/result', async (req, res) => {
    try {
        const authUser = await getUserFromAuthHeader(req.headers.authorization);
        const authWallet = authUser?.walletAddress;
        if (!isAdminRequest({ headers: req.headers }, authWallet)) {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const { matchId, winner } = req.body;
        if (typeof matchId !== 'string' || !matchId.trim()) {
            return res.status(400).json({ message: 'matchId is required' });
        }
        if (winner !== 'TEAM_A' && winner !== 'TEAM_B') {
            return res.status(400).json({ message: 'winner must be TEAM_A or TEAM_B' });
        }
        const { updatedMatch, setResultSig } = await prisma.$transaction(async (tx) => {
            const match = await tx.match.update({
                where: { id: matchId.trim() },
                data: {
                    result: winner,
                    status: 'FINISHED',
                },
            });
            await tx.predictionMarket.updateMany({
                where: { matchId: match.id },
                data: { status: 'SETTLED' },
            });
            const sig = await sendMemoTransaction({ op: 'set_result', matchId: match.id, result: winner });
            return { updatedMatch: match, setResultSig: sig };
        }, { timeout: 30000 });
        return res.json({
            message: 'Match result set',
            contractCall: {
                method: 'set_result',
                txSignature: setResultSig,
            },
            match: updatedMatch,
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed to set match result' });
    }
});
exchangeRouter.get('/teams', async (_req, res) => {
    try {
        const teams = await prisma.team.findMany({
            orderBy: { createdAt: 'desc' },
        });
        return res.json({
            message: 'Teams fetched',
            data: teams,
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed to fetch teams' });
    }
});
exchangeRouter.get('/assets', async (_req, res) => {
    try {
        const assets = await prisma.asset.findMany({
            include: {
                team: true,
                collection: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        return res.json({
            message: 'Assets fetched',
            data: assets.map((asset) => ({
                ...asset,
                currentPrice: priceAt(asset.basePrice, asset.bondingCurveK, asset.circulating),
            })),
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed to fetch assets' });
    }
});
exchangeRouter.post('/assets/buy/prepare', async (req, res) => {
    try {
        const user = await getUserFromAuthHeader(req.headers.authorization);
        if (!user)
            return res.status(401).json({ message: 'Unauthorized' });
        const { assetId, quantity } = req.body;
        if (typeof assetId !== 'string' || !assetId.trim())
            return res.status(400).json({ message: 'assetId is required' });
        const parsedQuantity = requirePositiveInt(quantity);
        if (!parsedQuantity)
            return res.status(400).json({ message: 'quantity must be a positive integer' });
        const asset = await prisma.asset.findUnique({ where: { id: assetId.trim() } });
        if (!asset)
            return res.status(404).json({ message: 'Asset not found' });
        if (!asset.mintAddress)
            return res.status(400).json({ message: 'Asset not yet minted on-chain' });
        if ((asset.circulating + parsedQuantity) > asset.totalSupply) {
            return res.status(400).json({ message: 'Requested quantity exceeds remaining supply' });
        }
        const cost = buyCost(asset.basePrice, asset.bondingCurveK, asset.circulating, parsedQuantity);
        const connection = getSolanaConnection();
        const payer = getPlatformSigner();
        const mint = new PublicKey(asset.mintAddress);
        const userWallet = new PublicKey(user.walletAddress);
        const treasuryATA = await getAssociatedTokenAddress(mint, payer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
        const userATA = await getAssociatedTokenAddress(mint, userWallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash });
        if (!(await connection.getAccountInfo(userATA))) {
            tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, userATA, userWallet, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
        }
        // Platform owns treasury ATA → platform signs the token transfer
        tx.add(createTransferInstruction(treasuryATA, userATA, payer.publicKey, parsedQuantity, [], TOKEN_PROGRAM_ID));
        // User signs this memo as proof of purchase
        tx.add(new TransactionInstruction({
            programId: MEMO_PROGRAM_ID,
            keys: [{ pubkey: userWallet, isSigner: true, isWritable: false }],
            data: Buffer.from(JSON.stringify({ op: 'buy_asset', assetId: asset.id, quantity: parsedQuantity, cost }), 'utf8'),
        }));
        tx.partialSign(payer);
        return res.json({
            unsignedTx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
            preview: { assetId: asset.id, assetName: asset.name, quantity: parsedQuantity, cost, currentPrice: priceAt(asset.basePrice, asset.bondingCurveK, asset.circulating) },
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message || 'Failed to prepare buy' });
    }
});
exchangeRouter.post('/assets/buy/confirm', async (req, res) => {
    try {
        const user = await getUserFromAuthHeader(req.headers.authorization);
        if (!user)
            return res.status(401).json({ message: 'Unauthorized' });
        const { txSignature, assetId, quantity } = req.body;
        if (typeof txSignature !== 'string' || !txSignature.trim())
            return res.status(400).json({ message: 'txSignature is required' });
        if (typeof assetId !== 'string' || !assetId.trim())
            return res.status(400).json({ message: 'assetId is required' });
        const parsedQuantity = requirePositiveInt(quantity);
        if (!parsedQuantity)
            return res.status(400).json({ message: 'quantity must be a positive integer' });
        const memo = await getConfirmedTxMemo(txSignature.trim());
        if (!memo)
            return res.status(400).json({ message: 'Transaction not found on-chain or missing memo' });
        if (memo.op !== 'buy_asset' || memo.assetId !== assetId.trim() || Number(memo.quantity) !== parsedQuantity) {
            return res.status(400).json({ message: 'Transaction memo does not match request parameters' });
        }
        const cost = typeof memo.cost === 'number' ? memo.cost : Number(memo.cost);
        const existingTx = await prisma.transaction.findFirst({ where: { txSignature: txSignature.trim(), userId: user.id } });
        if (existingTx)
            return res.json({ message: 'Already confirmed', transaction: existingTx });
        const result = await prisma.$transaction(async (tx) => {
            const asset = await tx.asset.findUnique({ where: { id: assetId.trim() } });
            if (!asset)
                throw new Error('Asset not found');
            const nextCirculating = asset.circulating + parsedQuantity;
            const updatedAsset = await tx.asset.update({
                where: { id: asset.id },
                data: { circulating: nextCirculating, currentPrice: priceAt(asset.basePrice, asset.bondingCurveK, nextCirculating) },
            });
            const existingHolding = await tx.userAsset.findUnique({ where: { userId_assetId: { userId: user.id, assetId: asset.id } } });
            if (existingHolding) {
                const nextQty = existingHolding.quantity + parsedQuantity;
                const nextAvg = ((existingHolding.avgPrice * existingHolding.quantity) + cost) / nextQty;
                await tx.userAsset.update({ where: { id: existingHolding.id }, data: { quantity: nextQty, avgPrice: nextAvg } });
            }
            else {
                await tx.userAsset.create({ data: { userId: user.id, assetId: asset.id, quantity: parsedQuantity, avgPrice: cost / parsedQuantity } });
            }
            const transaction = await tx.transaction.create({
                data: { userId: user.id, txType: 'BUY_ASSET', assetId: asset.id, quantity: parsedQuantity, amountUsdc: cost, txSignature: txSignature.trim() },
            });
            return { updatedAsset, cost, transaction };
        });
        return res.json({ message: 'Asset buy confirmed', asset: result.updatedAsset, quantity: parsedQuantity, totalCost: result.cost, transaction: result.transaction });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message || 'Failed to confirm buy' });
    }
});
exchangeRouter.post('/assets/sell/prepare', async (req, res) => {
    try {
        const user = await getUserFromAuthHeader(req.headers.authorization);
        if (!user)
            return res.status(401).json({ message: 'Unauthorized' });
        const { assetId, quantity } = req.body;
        if (typeof assetId !== 'string' || !assetId.trim())
            return res.status(400).json({ message: 'assetId is required' });
        const parsedQuantity = requirePositiveInt(quantity);
        if (!parsedQuantity)
            return res.status(400).json({ message: 'quantity must be a positive integer' });
        const asset = await prisma.asset.findUnique({ where: { id: assetId.trim() } });
        if (!asset)
            return res.status(404).json({ message: 'Asset not found' });
        if (!asset.mintAddress)
            return res.status(400).json({ message: 'Asset not yet minted on-chain' });
        const holding = await prisma.userAsset.findUnique({ where: { userId_assetId: { userId: user.id, assetId: asset.id } } });
        if (!holding || holding.quantity < parsedQuantity)
            return res.status(400).json({ message: 'Insufficient asset quantity' });
        const payout = sellPayout(asset.basePrice, asset.bondingCurveK, asset.circulating, parsedQuantity);
        const connection = getSolanaConnection();
        const payer = getPlatformSigner();
        const mint = new PublicKey(asset.mintAddress);
        const userWallet = new PublicKey(user.walletAddress);
        const treasuryATA = await getAssociatedTokenAddress(mint, payer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
        const userATA = await getAssociatedTokenAddress(mint, userWallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash });
        // User owns their ATA — Phantom must sign as token transfer authority
        tx.add(createTransferInstruction(userATA, treasuryATA, userWallet, parsedQuantity, [], TOKEN_PROGRAM_ID));
        tx.add(new TransactionInstruction({
            programId: MEMO_PROGRAM_ID,
            keys: [{ pubkey: userWallet, isSigner: true, isWritable: false }],
            data: Buffer.from(JSON.stringify({ op: 'sell_asset', assetId: asset.id, quantity: parsedQuantity, payout }), 'utf8'),
        }));
        // Platform signs only as fee payer; user must sign as token transfer authority + memo
        tx.partialSign(payer);
        return res.json({
            unsignedTx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
            preview: { assetId: asset.id, assetName: asset.name, quantity: parsedQuantity, payout, currentPrice: priceAt(asset.basePrice, asset.bondingCurveK, asset.circulating) },
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message || 'Failed to prepare sell' });
    }
});
exchangeRouter.post('/assets/sell/confirm', async (req, res) => {
    try {
        const user = await getUserFromAuthHeader(req.headers.authorization);
        if (!user)
            return res.status(401).json({ message: 'Unauthorized' });
        const { txSignature, assetId, quantity } = req.body;
        if (typeof txSignature !== 'string' || !txSignature.trim())
            return res.status(400).json({ message: 'txSignature is required' });
        if (typeof assetId !== 'string' || !assetId.trim())
            return res.status(400).json({ message: 'assetId is required' });
        const parsedQuantity = requirePositiveInt(quantity);
        if (!parsedQuantity)
            return res.status(400).json({ message: 'quantity must be a positive integer' });
        const memo = await getConfirmedTxMemo(txSignature.trim());
        if (!memo)
            return res.status(400).json({ message: 'Transaction not found on-chain or missing memo' });
        if (memo.op !== 'sell_asset' || memo.assetId !== assetId.trim() || Number(memo.quantity) !== parsedQuantity) {
            return res.status(400).json({ message: 'Transaction memo does not match request parameters' });
        }
        const payout = typeof memo.payout === 'number' ? memo.payout : Number(memo.payout);
        const existingTx = await prisma.transaction.findFirst({ where: { txSignature: txSignature.trim(), userId: user.id } });
        if (existingTx)
            return res.json({ message: 'Already confirmed', transaction: existingTx });
        const result = await prisma.$transaction(async (tx) => {
            const asset = await tx.asset.findUnique({ where: { id: assetId.trim() } });
            if (!asset)
                throw new Error('Asset not found');
            const holding = await tx.userAsset.findUnique({ where: { userId_assetId: { userId: user.id, assetId: asset.id } } });
            if (!holding || holding.quantity < parsedQuantity)
                throw new Error('Insufficient asset quantity');
            const nextCirculating = asset.circulating - parsedQuantity;
            const updatedAsset = await tx.asset.update({
                where: { id: asset.id },
                data: { circulating: nextCirculating, currentPrice: priceAt(asset.basePrice, asset.bondingCurveK, nextCirculating) },
            });
            const nextQty = holding.quantity - parsedQuantity;
            if (nextQty === 0) {
                await tx.userAsset.delete({ where: { id: holding.id } });
            }
            else {
                await tx.userAsset.update({ where: { id: holding.id }, data: { quantity: nextQty } });
            }
            const transaction = await tx.transaction.create({
                data: { userId: user.id, txType: 'SELL_ASSET', assetId: asset.id, quantity: parsedQuantity, amountUsdc: payout, txSignature: txSignature.trim() },
            });
            return { updatedAsset, payout, transaction };
        });
        return res.json({ message: 'Asset sell confirmed', asset: result.updatedAsset, quantity: parsedQuantity, totalPayout: result.payout, transaction: result.transaction });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message || 'Failed to confirm sell' });
    }
});
exchangeRouter.get('/matches', async (_req, res) => {
    try {
        const matches = await prisma.match.findMany({
            include: {
                teamA: true,
                teamB: true,
            },
            orderBy: { startTime: 'asc' },
        });
        return res.json({
            message: 'Matches fetched',
            data: matches,
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed to fetch matches' });
    }
});
exchangeRouter.get('/markets', async (_req, res) => {
    try {
        const markets = await prisma.predictionMarket.findMany({
            include: {
                match: {
                    include: {
                        teamA: true,
                        teamB: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return res.json({
            message: 'Markets fetched',
            data: markets.map((market) => ({
                ...market,
                teamAPrice: marketSidePrice(market.basePrice, market.curveK, market.supplyA),
                teamBPrice: marketSidePrice(market.basePrice, market.curveK, market.supplyB),
            })),
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed to fetch markets' });
    }
});
exchangeRouter.post('/markets/buy/prepare', async (req, res) => {
    try {
        const user = await getUserFromAuthHeader(req.headers.authorization);
        if (!user)
            return res.status(401).json({ message: 'Unauthorized' });
        const { marketId, side, quantity } = req.body;
        if (typeof marketId !== 'string' || !marketId.trim())
            return res.status(400).json({ message: 'marketId is required' });
        if (side !== 'TEAM_A' && side !== 'TEAM_B')
            return res.status(400).json({ message: 'side must be TEAM_A or TEAM_B' });
        const parsedQuantity = requirePositiveInt(quantity);
        if (!parsedQuantity)
            return res.status(400).json({ message: 'quantity must be a positive integer' });
        const market = await prisma.predictionMarket.findUnique({
            where: { id: marketId.trim() },
            include: { match: { include: { teamA: true, teamB: true } } },
        });
        if (!market)
            return res.status(404).json({ message: 'Market not found' });
        if (market.status !== 'OPEN')
            return res.status(400).json({ message: 'Market is not open' });
        const sideSupply = side === 'TEAM_A' ? market.supplyA : market.supplyB;
        const cost = marketBuyCost(market.basePrice, market.curveK, sideSupply, parsedQuantity);
        const payer = getPlatformSigner();
        const userWallet = new PublicKey(user.walletAddress);
        const { blockhash } = await getSolanaConnection().getLatestBlockhash('confirmed');
        const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash });
        // Prediction positions are off-chain DB records; user signs a memo as proof of intent
        tx.add(new TransactionInstruction({
            programId: MEMO_PROGRAM_ID,
            keys: [{ pubkey: userWallet, isSigner: true, isWritable: false }],
            data: Buffer.from(JSON.stringify({ op: 'buy_prediction', marketId: market.id, side, quantity: parsedQuantity, cost }), 'utf8'),
        }));
        tx.partialSign(payer);
        return res.json({
            unsignedTx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
            preview: { marketId: market.id, side, quantity: parsedQuantity, cost, teamAName: market.match.teamA.name, teamBName: market.match.teamB.name },
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message || 'Failed to prepare prediction buy' });
    }
});
exchangeRouter.post('/markets/buy/confirm', async (req, res) => {
    try {
        const user = await getUserFromAuthHeader(req.headers.authorization);
        if (!user)
            return res.status(401).json({ message: 'Unauthorized' });
        const { txSignature, marketId, side, quantity } = req.body;
        if (typeof txSignature !== 'string' || !txSignature.trim())
            return res.status(400).json({ message: 'txSignature is required' });
        if (typeof marketId !== 'string' || !marketId.trim())
            return res.status(400).json({ message: 'marketId is required' });
        if (side !== 'TEAM_A' && side !== 'TEAM_B')
            return res.status(400).json({ message: 'side must be TEAM_A or TEAM_B' });
        const parsedQuantity = requirePositiveInt(quantity);
        if (!parsedQuantity)
            return res.status(400).json({ message: 'quantity must be a positive integer' });
        const memo = await getConfirmedTxMemo(txSignature.trim());
        if (!memo)
            return res.status(400).json({ message: 'Transaction not found on-chain or missing memo' });
        if (memo.op !== 'buy_prediction' || memo.marketId !== marketId.trim() || memo.side !== side || Number(memo.quantity) !== parsedQuantity) {
            return res.status(400).json({ message: 'Transaction memo does not match request parameters' });
        }
        const cost = typeof memo.cost === 'number' ? memo.cost : Number(memo.cost);
        const existingTx = await prisma.transaction.findFirst({ where: { txSignature: txSignature.trim(), userId: user.id } });
        if (existingTx)
            return res.json({ message: 'Already confirmed', transaction: existingTx });
        const result = await prisma.$transaction(async (tx) => {
            const market = await tx.predictionMarket.findUnique({ where: { id: marketId.trim() }, include: { match: true } });
            if (!market)
                throw new Error('Market not found');
            if (market.status !== 'OPEN')
                throw new Error('Market is not open');
            const updatedMarket = await tx.predictionMarket.update({
                where: { id: market.id },
                data: side === 'TEAM_A'
                    ? { supplyA: { increment: parsedQuantity }, liquidityPool: { increment: cost } }
                    : { supplyB: { increment: parsedQuantity }, liquidityPool: { increment: cost } },
            });
            const existing = await tx.predictionPosition.findFirst({ where: { userId: user.id, marketId: market.id, team: side } });
            if (existing) {
                const nextAmount = existing.amount + parsedQuantity;
                const nextAvg = ((existing.avgPrice * existing.amount) + cost) / nextAmount;
                await tx.predictionPosition.update({ where: { id: existing.id }, data: { amount: nextAmount, avgPrice: nextAvg } });
            }
            else {
                await tx.predictionPosition.create({
                    data: { userId: user.id, marketId: market.id, team: side, amount: parsedQuantity, avgPrice: cost / parsedQuantity },
                });
            }
            const transaction = await tx.transaction.create({
                data: { userId: user.id, txType: 'BUY_PREDICTION', marketId: market.id, quantity: parsedQuantity, amountUsdc: cost, txSignature: txSignature.trim() },
            });
            return { updatedMarket, cost, transaction };
        });
        return res.json({ message: 'Prediction buy confirmed', market: result.updatedMarket, quantity: parsedQuantity, totalCost: result.cost, transaction: result.transaction });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message || 'Failed to confirm prediction buy' });
    }
});
exchangeRouter.post('/markets/sell/prepare', async (req, res) => {
    try {
        const user = await getUserFromAuthHeader(req.headers.authorization);
        if (!user)
            return res.status(401).json({ message: 'Unauthorized' });
        const { marketId, side, quantity } = req.body;
        if (typeof marketId !== 'string' || !marketId.trim())
            return res.status(400).json({ message: 'marketId is required' });
        if (side !== 'TEAM_A' && side !== 'TEAM_B')
            return res.status(400).json({ message: 'side must be TEAM_A or TEAM_B' });
        const parsedQuantity = requirePositiveInt(quantity);
        if (!parsedQuantity)
            return res.status(400).json({ message: 'quantity must be a positive integer' });
        const market = await prisma.predictionMarket.findUnique({
            where: { id: marketId.trim() },
            include: { match: { include: { teamA: true, teamB: true } } },
        });
        if (!market)
            return res.status(404).json({ message: 'Market not found' });
        if (market.status !== 'OPEN')
            return res.status(400).json({ message: 'Market is not open' });
        const position = await prisma.predictionPosition.findFirst({ where: { userId: user.id, marketId: market.id, team: side } });
        if (!position || position.amount < parsedQuantity)
            return res.status(400).json({ message: 'Insufficient prediction position' });
        const sideSupply = side === 'TEAM_A' ? market.supplyA : market.supplyB;
        const payout = marketSellPayout(market.basePrice, market.curveK, sideSupply, parsedQuantity);
        const payer = getPlatformSigner();
        const userWallet = new PublicKey(user.walletAddress);
        const { blockhash } = await getSolanaConnection().getLatestBlockhash('confirmed');
        const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash });
        tx.add(new TransactionInstruction({
            programId: MEMO_PROGRAM_ID,
            keys: [{ pubkey: userWallet, isSigner: true, isWritable: false }],
            data: Buffer.from(JSON.stringify({ op: 'sell_prediction', marketId: market.id, side, quantity: parsedQuantity, payout }), 'utf8'),
        }));
        tx.partialSign(payer);
        return res.json({
            unsignedTx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
            preview: { marketId: market.id, side, quantity: parsedQuantity, payout, teamAName: market.match.teamA.name, teamBName: market.match.teamB.name },
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message || 'Failed to prepare prediction sell' });
    }
});
exchangeRouter.post('/markets/sell/confirm', async (req, res) => {
    try {
        const user = await getUserFromAuthHeader(req.headers.authorization);
        if (!user)
            return res.status(401).json({ message: 'Unauthorized' });
        const { txSignature, marketId, side, quantity } = req.body;
        if (typeof txSignature !== 'string' || !txSignature.trim())
            return res.status(400).json({ message: 'txSignature is required' });
        if (typeof marketId !== 'string' || !marketId.trim())
            return res.status(400).json({ message: 'marketId is required' });
        if (side !== 'TEAM_A' && side !== 'TEAM_B')
            return res.status(400).json({ message: 'side must be TEAM_A or TEAM_B' });
        const parsedQuantity = requirePositiveInt(quantity);
        if (!parsedQuantity)
            return res.status(400).json({ message: 'quantity must be a positive integer' });
        const memo = await getConfirmedTxMemo(txSignature.trim());
        if (!memo)
            return res.status(400).json({ message: 'Transaction not found on-chain or missing memo' });
        if (memo.op !== 'sell_prediction' || memo.marketId !== marketId.trim() || memo.side !== side || Number(memo.quantity) !== parsedQuantity) {
            return res.status(400).json({ message: 'Transaction memo does not match request parameters' });
        }
        const payout = typeof memo.payout === 'number' ? memo.payout : Number(memo.payout);
        const existingTx = await prisma.transaction.findFirst({ where: { txSignature: txSignature.trim(), userId: user.id } });
        if (existingTx)
            return res.json({ message: 'Already confirmed', transaction: existingTx });
        const result = await prisma.$transaction(async (tx) => {
            const market = await tx.predictionMarket.findUnique({ where: { id: marketId.trim() } });
            if (!market)
                throw new Error('Market not found');
            if (market.status !== 'OPEN')
                throw new Error('Market is not open');
            const position = await tx.predictionPosition.findFirst({ where: { userId: user.id, marketId: market.id, team: side } });
            if (!position || position.amount < parsedQuantity)
                throw new Error('Insufficient prediction position');
            const sideSupply = side === 'TEAM_A' ? market.supplyA : market.supplyB;
            if (sideSupply < parsedQuantity)
                throw new Error('Invalid market side supply state');
            if (market.liquidityPool < payout)
                throw new Error('Insufficient market liquidity');
            const updatedMarket = await tx.predictionMarket.update({
                where: { id: market.id },
                data: side === 'TEAM_A'
                    ? { supplyA: { decrement: parsedQuantity }, liquidityPool: { decrement: payout } }
                    : { supplyB: { decrement: parsedQuantity }, liquidityPool: { decrement: payout } },
            });
            const nextAmount = position.amount - parsedQuantity;
            if (nextAmount === 0) {
                await tx.predictionPosition.delete({ where: { id: position.id } });
            }
            else {
                await tx.predictionPosition.update({ where: { id: position.id }, data: { amount: nextAmount } });
            }
            const transaction = await tx.transaction.create({
                data: { userId: user.id, txType: 'SELL_PREDICTION', marketId: market.id, quantity: parsedQuantity, amountUsdc: payout, txSignature: txSignature.trim() },
            });
            return { updatedMarket, payout, transaction };
        });
        return res.json({ message: 'Prediction sell confirmed', market: result.updatedMarket, quantity: parsedQuantity, totalPayout: result.payout, transaction: result.transaction });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message || 'Failed to confirm prediction sell' });
    }
});
exchangeRouter.post('/markets/claim/prepare', async (req, res) => {
    try {
        const user = await getUserFromAuthHeader(req.headers.authorization);
        if (!user)
            return res.status(401).json({ message: 'Unauthorized' });
        const { marketId } = req.body;
        if (typeof marketId !== 'string' || !marketId.trim())
            return res.status(400).json({ message: 'marketId is required' });
        const market = await prisma.predictionMarket.findUnique({
            where: { id: marketId.trim() },
            include: { match: { include: { teamA: true, teamB: true } } },
        });
        if (!market)
            return res.status(404).json({ message: 'Market not found' });
        if (market.status !== 'SETTLED')
            return res.status(400).json({ message: 'Market is not yet settled' });
        if (market.match.result !== 'TEAM_A' && market.match.result !== 'TEAM_B')
            return res.status(400).json({ message: 'Match result not available' });
        const alreadyClaimed = await prisma.transaction.findFirst({ where: { userId: user.id, marketId: market.id, txType: 'CLAIM_REWARD' } });
        if (alreadyClaimed)
            return res.status(400).json({ message: 'Rewards already claimed', transaction: alreadyClaimed });
        const winningSide = market.match.result;
        const winnerSupply = winningSide === 'TEAM_A' ? market.supplyA : market.supplyB;
        if (winnerSupply <= 0)
            return res.status(400).json({ message: 'No winning supply available' });
        const winningPositions = await prisma.predictionPosition.findMany({ where: { userId: user.id, marketId: market.id, team: winningSide } });
        const myWinningAmount = winningPositions.reduce((acc, p) => acc + p.amount, 0);
        if (myWinningAmount <= 0)
            return res.status(400).json({ message: 'No winning position to claim' });
        const payout = (market.liquidityPool * myWinningAmount) / winnerSupply;
        const payer = getPlatformSigner();
        const userWallet = new PublicKey(user.walletAddress);
        const { blockhash } = await getSolanaConnection().getLatestBlockhash('confirmed');
        const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash });
        tx.add(new TransactionInstruction({
            programId: MEMO_PROGRAM_ID,
            keys: [{ pubkey: userWallet, isSigner: true, isWritable: false }],
            data: Buffer.from(JSON.stringify({ op: 'claim_reward', marketId: market.id, payout, winningAmount: myWinningAmount }), 'utf8'),
        }));
        tx.partialSign(payer);
        return res.json({
            unsignedTx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
            preview: { marketId: market.id, winningSide, winningAmount: myWinningAmount, payout, teamAName: market.match.teamA.name, teamBName: market.match.teamB.name },
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message || 'Failed to prepare claim' });
    }
});
exchangeRouter.post('/markets/claim/confirm', async (req, res) => {
    try {
        const user = await getUserFromAuthHeader(req.headers.authorization);
        if (!user)
            return res.status(401).json({ message: 'Unauthorized' });
        const { txSignature, marketId } = req.body;
        if (typeof txSignature !== 'string' || !txSignature.trim())
            return res.status(400).json({ message: 'txSignature is required' });
        if (typeof marketId !== 'string' || !marketId.trim())
            return res.status(400).json({ message: 'marketId is required' });
        const memo = await getConfirmedTxMemo(txSignature.trim());
        if (!memo)
            return res.status(400).json({ message: 'Transaction not found on-chain or missing memo' });
        if (memo.op !== 'claim_reward' || memo.marketId !== marketId.trim()) {
            return res.status(400).json({ message: 'Transaction memo does not match request parameters' });
        }
        const existingTx = await prisma.transaction.findFirst({ where: { txSignature: txSignature.trim(), userId: user.id } });
        if (existingTx)
            return res.json({ message: 'Already confirmed', transaction: existingTx });
        const result = await prisma.$transaction(async (tx) => {
            const market = await tx.predictionMarket.findUnique({ where: { id: marketId.trim() }, include: { match: true } });
            if (!market)
                throw new Error('Market not found');
            if (market.status !== 'SETTLED')
                throw new Error('Market is not settled');
            if (market.match.result !== 'TEAM_A' && market.match.result !== 'TEAM_B')
                throw new Error('Match result not available');
            const alreadyClaimed = await tx.transaction.findFirst({ where: { userId: user.id, marketId: market.id, txType: 'CLAIM_REWARD' } });
            if (alreadyClaimed)
                return { payout: 0, transaction: alreadyClaimed, alreadyClaimed: true };
            const winningSide = market.match.result;
            const winnerSupply = winningSide === 'TEAM_A' ? market.supplyA : market.supplyB;
            if (winnerSupply <= 0)
                throw new Error('No winning supply available');
            const myWinningPositions = await tx.predictionPosition.findMany({ where: { userId: user.id, marketId: market.id, team: winningSide } });
            const myWinningAmount = myWinningPositions.reduce((acc, p) => acc + p.amount, 0);
            if (myWinningAmount <= 0)
                throw new Error('No winning position to claim');
            const payout = (market.liquidityPool * myWinningAmount) / winnerSupply;
            for (const pos of myWinningPositions) {
                await tx.predictionPosition.update({ where: { id: pos.id }, data: { amount: 0 } });
            }
            const claimTx = await tx.transaction.create({
                data: { userId: user.id, txType: 'CLAIM_REWARD', marketId: market.id, amountUsdc: payout, quantity: myWinningAmount, txSignature: txSignature.trim() },
            });
            return { payout, transaction: claimTx, alreadyClaimed: false };
        });
        return res.json({
            message: result.alreadyClaimed ? 'Rewards already claimed' : 'Rewards claimed',
            payout: result.payout,
            transaction: result.transaction,
        });
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: error.message || 'Failed to confirm claim' });
    }
});
exchangeRouter.get('/debug/exchange-state', async (_req, res) => {
    try {
        const [teams, assets, matches, markets] = await Promise.all([
            prisma.team.count(),
            prisma.asset.count(),
            prisma.match.count(),
            prisma.predictionMarket.count(),
        ]);
        return res.json(toJsonSafe({ teams, assets, matches, markets }));
    }
    catch (error) {
        console.log(error);
        return res.status(500).json({ message: 'Failed to load debug state' });
    }
});
export default exchangeRouter;
//# sourceMappingURL=exchange.route.js.map