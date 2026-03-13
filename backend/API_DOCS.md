# Esports Exchange API Documentation

## Overview

This backend exposes two route groups:

- `/api` for wallet auth, admin exchange setup, public market reads, and trading flows
- `/user` for legacy user profile and wallet lookup endpoints

Runtime base URL in local development:

- `http://localhost:3000`

Mounted routes:

- Exchange routes: `http://localhost:3000/api`
- User routes: `http://localhost:3000/user`

The product is a hybrid esports exchange MVP:

- Team assets are minted on Solana devnet and transferred through real SPL token transactions
- Prediction market positions are accounted for off-chain in Prisma, but users still sign real Solana memo transactions as proof of intent
- Every user trade follows a `prepare -> wallet sign -> broadcast -> confirm` workflow

## Authentication

Protected endpoints require:

```http
Authorization: Bearer <jwt>
```

JWT tokens are issued by:

- `POST /api/auth/wallet`
- `POST /user/signin` (legacy flow)

## Admin Authorization

Admin endpoints accept either of these authorization models:

1. Valid JWT for a wallet address included in `ADMIN_WALLETS`
2. `x-admin-key: <ADMIN_API_KEY>` header if `ADMIN_API_KEY` is configured

Recommended admin request headers:

```http
Authorization: Bearer <jwt>
Content-Type: application/json
x-admin-key: <ADMIN_API_KEY>
```

## Standard Trading Workflow

All user trading endpoints now use this pattern.

1. Frontend calls a `prepare` endpoint.
2. Backend returns `unsignedTx` and a `preview` object.
3. Frontend deserializes the transaction and asks Phantom to sign it.
4. Frontend broadcasts the signed transaction to Solana devnet.
5. Frontend sends the resulting `txSignature` to the matching `confirm` endpoint.
6. Backend verifies the on-chain memo and then updates the database.

Frontend reference flow:

```javascript
const prepare = await fetch('http://localhost:3000/api/assets/buy/prepare', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    assetId: 'cm8asset123',
    quantity: 2,
  }),
}).then((r) => r.json())

const tx = Transaction.from(Buffer.from(prepare.unsignedTx, 'base64'))
const signedTx = await wallet.signTransaction(tx)
const txSignature = await connection.sendRawTransaction(signedTx.serialize())
await connection.confirmTransaction(txSignature, 'confirmed')

const confirm = await fetch('http://localhost:3000/api/assets/buy/confirm', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    txSignature,
    assetId: 'cm8asset123',
    quantity: 2,
  }),
}).then((r) => r.json())
```

## Root Endpoint

### GET /

Health-style root endpoint.

Response:

```json
{
  "message": "solana is great"
}
```

## API Route Index

### Exchange and Trading Routes under `/api`

- `POST /api/auth/wallet`
- `POST /api/admin/teams`
- `POST /api/admin/collections`
- `POST /api/admin/assets/mint`
- `POST /api/admin/matches`
- `POST /api/admin/markets`
- `POST /api/admin/markets/liquidity`
- `POST /api/admin/matches/result`
- `GET /api/teams`
- `GET /api/assets`
- `POST /api/assets/buy/prepare`
- `POST /api/assets/buy/confirm`
- `POST /api/assets/sell/prepare`
- `POST /api/assets/sell/confirm`
- `GET /api/matches`
- `GET /api/markets`
- `POST /api/markets/buy/prepare`
- `POST /api/markets/buy/confirm`
- `POST /api/markets/sell/prepare`
- `POST /api/markets/sell/confirm`
- `POST /api/markets/claim/prepare`
- `POST /api/markets/claim/confirm`
- `GET /api/debug/exchange-state`

### User Routes under `/user`

- `GET /user/by-wallet/:walletAddress`
- `POST /user/signin`
- `PUT /user/profile`
- `GET /user/profile`

## Data Models Returned by the API

These are the key shapes used in the example responses.

### User

```json
{
  "id": "cm8user123",
  "walletAddress": "9xQeWvG816bUx9EPjHmaT23yvVMR9hM1S9h8y5RzV5j",
  "username": "alphafan",
  "avatarUrl": null,
  "country": "India",
  "bio": "Esports fan and trader",
  "createdAt": "2026-03-13T10:00:00.000Z"
}
```

### Team

```json
{
  "id": "cm8team123",
  "name": "Team Spirit",
  "game": "Dota 2",
  "region": "EU",
  "logoUrl": "https://cdn.example.com/team-spirit.png",
  "createdAt": "2026-03-13T10:10:00.000Z"
}
```

### Asset Collection

```json
{
  "id": "cm8collection123",
  "name": "Blue Chip Teams",
  "description": "Top esports teams collection",
  "collectionMint": "5FcollectionMint1111111111111111111111111111",
  "metadataUri": "https://ik.imagekit.io/demo/collections/blue-chip.json",
  "createdAt": "2026-03-13T10:12:00.000Z"
}
```

### Asset

```json
{
  "id": "cm8asset123",
  "name": "Team Spirit Alpha",
  "assetType": "TEAM",
  "teamId": "cm8team123",
  "collectionId": "cm8collection123",
  "mintAddress": "8Mint1111111111111111111111111111111111111",
  "metadataUri": "https://ik.imagekit.io/demo/assets/team-spirit-alpha.json",
  "basePrice": 5,
  "currentPrice": 5.4,
  "totalSupply": 1000,
  "circulating": 4,
  "bondingCurveK": 0.1,
  "createdAt": "2026-03-13T10:15:00.000Z"
}
```

### Match

```json
{
  "id": "cm8match123",
  "teamAId": "cm8team123",
  "teamBId": "cm8team456",
  "tournament": "DreamLeague Season 25",
  "startTime": "2026-03-20T16:00:00.000Z",
  "status": "SCHEDULED",
  "result": null,
  "createdAt": "2026-03-13T10:20:00.000Z"
}
```

### Prediction Market

```json
{
  "id": "cm8market123",
  "matchId": "cm8match123",
  "contractAddr": "5nTxSig1111111111111111111111111111111111",
  "liquidityPool": 1000,
  "supplyA": 10,
  "supplyB": 8,
  "basePrice": 1,
  "curveK": 0.05,
  "status": "OPEN",
  "createdAt": "2026-03-13T10:25:00.000Z"
}
```

### Transaction

```json
{
  "id": "cm8tx123",
  "userId": "cm8user123",
  "txType": "BUY_ASSET",
  "assetId": "cm8asset123",
  "marketId": null,
  "quantity": 2,
  "amountUsdc": 10.1,
  "txSignature": "3sig11111111111111111111111111111111111111",
  "createdAt": "2026-03-13T10:30:00.000Z"
}
```

## Exchange Auth Endpoint

### POST /api/auth/wallet

Authenticates a wallet for the exchange flow and returns a JWT.

Headers:

```http
Content-Type: application/json
```

Request body example with all accepted input concepts:

```json
{
  "walletAddress": "9xQeWvG816bUx9EPjHmaT23yvVMR9hM1S9h8y5RzV5j",
  "signature": "MEUCIQDbExampleBase64SignatureStringThatDecodesTo64Bytes=="
}
```

Notes:

- `walletAddress` must be a valid Solana public key string
- `signature` can be passed as a base64 string or another 64-byte-compatible shape accepted by the backend
- The signed message is `AUTH_SIGN_MESSAGE` env var or the default `Sign into mechanical turks`

Success response example:

```json
{
  "message": "existing",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example.token",
  "user": {
    "id": "cm8user123",
    "walletAddress": "9xQeWvG816bUx9EPjHmaT23yvVMR9hM1S9h8y5RzV5j",
    "username": "alphafan"
  }
}
```

Possible error responses:

```json
{
  "message": "Invalid walletAddress"
}
```

```json
{
  "message": "Invalid signature format/size (expected 64 bytes)"
}
```

```json
{
  "message": "Incorrect signature"
}
```

## Admin Endpoints

### POST /api/admin/teams

Creates a team.

Headers:

```http
Content-Type: application/json
Authorization: Bearer <jwt>
x-admin-key: <ADMIN_API_KEY>
```

Request body example with all supported fields:

```json
{
  "name": "Team Spirit",
  "game": "Dota 2",
  "region": "EU",
  "logoUrl": "https://cdn.example.com/teams/team-spirit.png"
}
```

Success response:

```json
{
  "message": "Team created",
  "team": {
    "id": "cm8team123",
    "name": "Team Spirit",
    "game": "Dota 2",
    "region": "EU",
    "logoUrl": "https://cdn.example.com/teams/team-spirit.png",
    "createdAt": "2026-03-13T10:10:00.000Z"
  }
}
```

### POST /api/admin/collections

Creates an asset collection.

Request body example with all supported fields:

```json
{
  "name": "Blue Chip Teams",
  "description": "Top esports teams collection",
  "collectionMint": "5FcollectionMint1111111111111111111111111111",
  "metadataUri": "https://ik.imagekit.io/demo/collections/blue-chip.json"
}
```

Success response:

```json
{
  "message": "Collection created",
  "collection": {
    "id": "cm8collection123",
    "name": "Blue Chip Teams",
    "description": "Top esports teams collection",
    "collectionMint": "5FcollectionMint1111111111111111111111111111",
    "metadataUri": "https://ik.imagekit.io/demo/collections/blue-chip.json",
    "createdAt": "2026-03-13T10:12:00.000Z"
  }
}
```

### POST /api/admin/assets/mint

Creates and mints a team asset.

Request body example with all supported fields:

```json
{
  "name": "Team Spirit Alpha",
  "teamId": "cm8team123",
  "collectionId": "cm8collection123",
  "totalSupply": 1000,
  "basePrice": 5,
  "kFactor": 0.1
}
```

Success response:

```json
{
  "message": "Asset minted",
  "asset": {
    "id": "cm8asset123",
    "name": "Team Spirit Alpha",
    "assetType": "TEAM",
    "teamId": "cm8team123",
    "collectionId": "cm8collection123",
    "mintAddress": "8Mint1111111111111111111111111111111111111",
    "metadataUri": "https://ik.imagekit.io/demo/assets/team-spirit-alpha.json",
    "basePrice": 5,
    "currentPrice": 5,
    "totalSupply": 1000,
    "circulating": 0,
    "bondingCurveK": 0.1,
    "createdAt": "2026-03-13T10:15:00.000Z"
  },
  "mint": {
    "mintAddress": "8Mint1111111111111111111111111111111111111",
    "treasuryPda": "ATATreasury11111111111111111111111111111111",
    "txSignature": "4mintTx11111111111111111111111111111111111"
  }
}
```

### POST /api/admin/matches

Creates a match between two teams.

Request body example with all supported fields:

```json
{
  "teamAId": "cm8team123",
  "teamBId": "cm8team456",
  "tournament": "DreamLeague Season 25",
  "startTime": "2026-03-20T16:00:00.000Z"
}
```

Success response:

```json
{
  "message": "Match created",
  "match": {
    "id": "cm8match123",
    "teamAId": "cm8team123",
    "teamBId": "cm8team456",
    "tournament": "DreamLeague Season 25",
    "startTime": "2026-03-20T16:00:00.000Z",
    "status": "SCHEDULED",
    "result": null,
    "createdAt": "2026-03-13T10:20:00.000Z",
    "teamA": {
      "id": "cm8team123",
      "name": "Team Spirit",
      "game": "Dota 2",
      "region": "EU",
      "logoUrl": "https://cdn.example.com/teams/team-spirit.png",
      "createdAt": "2026-03-13T10:10:00.000Z"
    },
    "teamB": {
      "id": "cm8team456",
      "name": "Falcons",
      "game": "Dota 2",
      "region": "MENA",
      "logoUrl": "https://cdn.example.com/teams/falcons.png",
      "createdAt": "2026-03-13T10:11:00.000Z"
    }
  }
}
```

### POST /api/admin/markets

Creates a prediction market for a match.

Request body example with all supported fields:

```json
{
  "matchId": "cm8match123",
  "basePrice": 1,
  "kFactor": 0.05,
  "initialLiquidity": 1000
}
```

Success response:

```json
{
  "message": "Market created",
  "contractCall": {
    "method": "create_market",
    "txSignature": "5marketCreate111111111111111111111111111111"
  },
  "market": {
    "id": "cm8market123",
    "matchId": "cm8match123",
    "contractAddr": "5marketCreate111111111111111111111111111111",
    "liquidityPool": 1000,
    "supplyA": 0,
    "supplyB": 0,
    "basePrice": 1,
    "curveK": 0.05,
    "status": "OPEN",
    "createdAt": "2026-03-13T10:25:00.000Z",
    "match": {
      "id": "cm8match123",
      "teamAId": "cm8team123",
      "teamBId": "cm8team456",
      "tournament": "DreamLeague Season 25",
      "startTime": "2026-03-20T16:00:00.000Z",
      "status": "SCHEDULED",
      "result": null,
      "createdAt": "2026-03-13T10:20:00.000Z",
      "teamA": {
        "id": "cm8team123",
        "name": "Team Spirit",
        "game": "Dota 2",
        "region": "EU",
        "logoUrl": "https://cdn.example.com/teams/team-spirit.png",
        "createdAt": "2026-03-13T10:10:00.000Z"
      },
      "teamB": {
        "id": "cm8team456",
        "name": "Falcons",
        "game": "Dota 2",
        "region": "MENA",
        "logoUrl": "https://cdn.example.com/teams/falcons.png",
        "createdAt": "2026-03-13T10:11:00.000Z"
      }
    }
  }
}
```

### POST /api/admin/markets/liquidity

Adds liquidity to an existing prediction market.

Request body example with all supported fields:

```json
{
  "marketId": "cm8market123",
  "amount": 500
}
```

Success response:

```json
{
  "message": "Liquidity added",
  "contractCall": {
    "method": "add_liquidity",
    "txSignature": "6liquidityTx1111111111111111111111111111111"
  },
  "market": {
    "id": "cm8market123",
    "matchId": "cm8match123",
    "contractAddr": "5marketCreate111111111111111111111111111111",
    "liquidityPool": 1500,
    "supplyA": 0,
    "supplyB": 0,
    "basePrice": 1,
    "curveK": 0.05,
    "status": "OPEN",
    "createdAt": "2026-03-13T10:25:00.000Z"
  }
}
```

### POST /api/admin/matches/result

Sets the winning side and settles linked market(s).

Request body example with all supported fields:

```json
{
  "matchId": "cm8match123",
  "winner": "TEAM_A"
}
```

Success response:

```json
{
  "message": "Match result set",
  "contractCall": {
    "method": "set_result",
    "txSignature": "7resultTx111111111111111111111111111111111"
  },
  "match": {
    "id": "cm8match123",
    "teamAId": "cm8team123",
    "teamBId": "cm8team456",
    "tournament": "DreamLeague Season 25",
    "startTime": "2026-03-20T16:00:00.000Z",
    "status": "FINISHED",
    "result": "TEAM_A",
    "createdAt": "2026-03-13T10:20:00.000Z"
  }
}
```

## Public Read Endpoints

### GET /api/teams

Fetches all teams.

Success response:

```json
{
  "message": "Teams fetched",
  "data": [
    {
      "id": "cm8team123",
      "name": "Team Spirit",
      "game": "Dota 2",
      "region": "EU",
      "logoUrl": "https://cdn.example.com/teams/team-spirit.png",
      "createdAt": "2026-03-13T10:10:00.000Z"
    },
    {
      "id": "cm8team456",
      "name": "Falcons",
      "game": "Dota 2",
      "region": "MENA",
      "logoUrl": "https://cdn.example.com/teams/falcons.png",
      "createdAt": "2026-03-13T10:11:00.000Z"
    }
  ]
}
```

### GET /api/assets

Fetches all minted assets. The backend recalculates `currentPrice` from the bonding curve before returning the response.

Success response:

```json
{
  "message": "Assets fetched",
  "data": [
    {
      "id": "cm8asset123",
      "name": "Team Spirit Alpha",
      "assetType": "TEAM",
      "teamId": "cm8team123",
      "collectionId": "cm8collection123",
      "mintAddress": "8Mint1111111111111111111111111111111111111",
      "metadataUri": "https://ik.imagekit.io/demo/assets/team-spirit-alpha.json",
      "basePrice": 5,
      "currentPrice": 5.4,
      "totalSupply": 1000,
      "circulating": 4,
      "bondingCurveK": 0.1,
      "createdAt": "2026-03-13T10:15:00.000Z",
      "team": {
        "id": "cm8team123",
        "name": "Team Spirit",
        "game": "Dota 2",
        "region": "EU",
        "logoUrl": "https://cdn.example.com/teams/team-spirit.png",
        "createdAt": "2026-03-13T10:10:00.000Z"
      },
      "collection": {
        "id": "cm8collection123",
        "name": "Blue Chip Teams",
        "description": "Top esports teams collection",
        "collectionMint": "5FcollectionMint1111111111111111111111111111",
        "metadataUri": "https://ik.imagekit.io/demo/collections/blue-chip.json",
        "createdAt": "2026-03-13T10:12:00.000Z"
      }
    }
  ]
}
```

### GET /api/matches

Fetches all matches ordered by start time.

Success response:

```json
{
  "message": "Matches fetched",
  "data": [
    {
      "id": "cm8match123",
      "teamAId": "cm8team123",
      "teamBId": "cm8team456",
      "tournament": "DreamLeague Season 25",
      "startTime": "2026-03-20T16:00:00.000Z",
      "status": "SCHEDULED",
      "result": null,
      "createdAt": "2026-03-13T10:20:00.000Z",
      "teamA": {
        "id": "cm8team123",
        "name": "Team Spirit",
        "game": "Dota 2",
        "region": "EU",
        "logoUrl": "https://cdn.example.com/teams/team-spirit.png",
        "createdAt": "2026-03-13T10:10:00.000Z"
      },
      "teamB": {
        "id": "cm8team456",
        "name": "Falcons",
        "game": "Dota 2",
        "region": "MENA",
        "logoUrl": "https://cdn.example.com/teams/falcons.png",
        "createdAt": "2026-03-13T10:11:00.000Z"
      }
    }
  ]
}
```

### GET /api/markets

Fetches all prediction markets. The backend adds derived `teamAPrice` and `teamBPrice` values.

Success response:

```json
{
  "message": "Markets fetched",
  "data": [
    {
      "id": "cm8market123",
      "matchId": "cm8match123",
      "contractAddr": "5marketCreate111111111111111111111111111111",
      "liquidityPool": 1500,
      "supplyA": 10,
      "supplyB": 8,
      "basePrice": 1,
      "curveK": 0.05,
      "status": "OPEN",
      "createdAt": "2026-03-13T10:25:00.000Z",
      "match": {
        "id": "cm8match123",
        "teamAId": "cm8team123",
        "teamBId": "cm8team456",
        "tournament": "DreamLeague Season 25",
        "startTime": "2026-03-20T16:00:00.000Z",
        "status": "SCHEDULED",
        "result": null,
        "createdAt": "2026-03-13T10:20:00.000Z",
        "teamA": {
          "id": "cm8team123",
          "name": "Team Spirit",
          "game": "Dota 2",
          "region": "EU",
          "logoUrl": "https://cdn.example.com/teams/team-spirit.png",
          "createdAt": "2026-03-13T10:10:00.000Z"
        },
        "teamB": {
          "id": "cm8team456",
          "name": "Falcons",
          "game": "Dota 2",
          "region": "MENA",
          "logoUrl": "https://cdn.example.com/teams/falcons.png",
          "createdAt": "2026-03-13T10:11:00.000Z"
        }
      },
      "teamAPrice": 1.5,
      "teamBPrice": 1.4
    }
  ]
}
```

### GET /api/debug/exchange-state

Returns record counts for quick debugging.

Success response:

```json
{
  "teams": 2,
  "assets": 1,
  "matches": 1,
  "markets": 1
}
```

## Asset Trading Endpoints

### POST /api/assets/buy/prepare

Builds an unsigned devnet transaction for buying an asset.

Request body example with all supported fields:

```json
{
  "assetId": "cm8asset123",
  "quantity": 2
}
```

Success response:

```json
{
  "unsignedTx": "AQABAgMExampleBase64SerializedTransactionForPhantomSign",
  "preview": {
    "assetId": "cm8asset123",
    "assetName": "Team Spirit Alpha",
    "quantity": 2,
    "cost": 10.1,
    "currentPrice": 5.4
  }
}
```

### POST /api/assets/buy/confirm

Verifies the signed transaction and persists the buy.

Request body example with all supported fields:

```json
{
  "txSignature": "3buyConfirm111111111111111111111111111111111",
  "assetId": "cm8asset123",
  "quantity": 2
}
```

Success response:

```json
{
  "message": "Asset buy confirmed",
  "asset": {
    "id": "cm8asset123",
    "name": "Team Spirit Alpha",
    "assetType": "TEAM",
    "teamId": "cm8team123",
    "collectionId": "cm8collection123",
    "mintAddress": "8Mint1111111111111111111111111111111111111",
    "metadataUri": "https://ik.imagekit.io/demo/assets/team-spirit-alpha.json",
    "basePrice": 5,
    "currentPrice": 5.6,
    "totalSupply": 1000,
    "circulating": 6,
    "bondingCurveK": 0.1,
    "createdAt": "2026-03-13T10:15:00.000Z"
  },
  "quantity": 2,
  "totalCost": 10.1,
  "transaction": {
    "id": "cm8tx123",
    "userId": "cm8user123",
    "txType": "BUY_ASSET",
    "assetId": "cm8asset123",
    "marketId": null,
    "quantity": 2,
    "amountUsdc": 10.1,
    "txSignature": "3buyConfirm111111111111111111111111111111111",
    "createdAt": "2026-03-13T10:30:00.000Z"
  }
}
```

### POST /api/assets/sell/prepare

Builds an unsigned devnet transaction for selling an asset.

Request body example with all supported fields:

```json
{
  "assetId": "cm8asset123",
  "quantity": 1
}
```

Success response:

```json
{
  "unsignedTx": "AQABAgMExampleBase64SerializedSellTransaction",
  "preview": {
    "assetId": "cm8asset123",
    "assetName": "Team Spirit Alpha",
    "quantity": 1,
    "payout": 5.5,
    "currentPrice": 5.6
  }
}
```

### POST /api/assets/sell/confirm

Verifies the signed transaction and persists the sell.

Request body example with all supported fields:

```json
{
  "txSignature": "3sellConfirm11111111111111111111111111111111",
  "assetId": "cm8asset123",
  "quantity": 1
}
```

Success response:

```json
{
  "message": "Asset sell confirmed",
  "asset": {
    "id": "cm8asset123",
    "name": "Team Spirit Alpha",
    "assetType": "TEAM",
    "teamId": "cm8team123",
    "collectionId": "cm8collection123",
    "mintAddress": "8Mint1111111111111111111111111111111111111",
    "metadataUri": "https://ik.imagekit.io/demo/assets/team-spirit-alpha.json",
    "basePrice": 5,
    "currentPrice": 5.5,
    "totalSupply": 1000,
    "circulating": 5,
    "bondingCurveK": 0.1,
    "createdAt": "2026-03-13T10:15:00.000Z"
  },
  "quantity": 1,
  "totalPayout": 5.5,
  "transaction": {
    "id": "cm8tx124",
    "userId": "cm8user123",
    "txType": "SELL_ASSET",
    "assetId": "cm8asset123",
    "marketId": null,
    "quantity": 1,
    "amountUsdc": 5.5,
    "txSignature": "3sellConfirm11111111111111111111111111111111",
    "createdAt": "2026-03-13T10:35:00.000Z"
  }
}
```

## Prediction Market Trading Endpoints

### POST /api/markets/buy/prepare

Builds an unsigned transaction for buying a prediction position.

Request body example with all supported fields:

```json
{
  "marketId": "cm8market123",
  "side": "TEAM_A",
  "quantity": 5
}
```

Success response:

```json
{
  "unsignedTx": "AQABAgMExampleBase64PredictionBuyTransaction",
  "preview": {
    "marketId": "cm8market123",
    "side": "TEAM_A",
    "quantity": 5,
    "cost": 6.25,
    "teamAName": "Team Spirit",
    "teamBName": "Falcons"
  }
}
```

### POST /api/markets/buy/confirm

Verifies the signed transaction and persists the position buy.

Request body example with all supported fields:

```json
{
  "txSignature": "4predictionBuy111111111111111111111111111111",
  "marketId": "cm8market123",
  "side": "TEAM_A",
  "quantity": 5
}
```

Success response:

```json
{
  "message": "Prediction buy confirmed",
  "market": {
    "id": "cm8market123",
    "matchId": "cm8match123",
    "contractAddr": "5marketCreate111111111111111111111111111111",
    "liquidityPool": 1506.25,
    "supplyA": 15,
    "supplyB": 8,
    "basePrice": 1,
    "curveK": 0.05,
    "status": "OPEN",
    "createdAt": "2026-03-13T10:25:00.000Z"
  },
  "quantity": 5,
  "totalCost": 6.25,
  "transaction": {
    "id": "cm8tx125",
    "userId": "cm8user123",
    "txType": "BUY_PREDICTION",
    "assetId": null,
    "marketId": "cm8market123",
    "quantity": 5,
    "amountUsdc": 6.25,
    "txSignature": "4predictionBuy111111111111111111111111111111",
    "createdAt": "2026-03-13T10:40:00.000Z"
  }
}
```

### POST /api/markets/sell/prepare

Builds an unsigned transaction for selling a prediction position.

Request body example with all supported fields:

```json
{
  "marketId": "cm8market123",
  "side": "TEAM_A",
  "quantity": 2
}
```

Success response:

```json
{
  "unsignedTx": "AQABAgMExampleBase64PredictionSellTransaction",
  "preview": {
    "marketId": "cm8market123",
    "side": "TEAM_A",
    "quantity": 2,
    "payout": 2.85,
    "teamAName": "Team Spirit",
    "teamBName": "Falcons"
  }
}
```

### POST /api/markets/sell/confirm

Verifies the signed transaction and persists the position sell.

Request body example with all supported fields:

```json
{
  "txSignature": "4predictionSell11111111111111111111111111111",
  "marketId": "cm8market123",
  "side": "TEAM_A",
  "quantity": 2
}
```

Success response:

```json
{
  "message": "Prediction sell confirmed",
  "market": {
    "id": "cm8market123",
    "matchId": "cm8match123",
    "contractAddr": "5marketCreate111111111111111111111111111111",
    "liquidityPool": 1503.4,
    "supplyA": 13,
    "supplyB": 8,
    "basePrice": 1,
    "curveK": 0.05,
    "status": "OPEN",
    "createdAt": "2026-03-13T10:25:00.000Z"
  },
  "quantity": 2,
  "totalPayout": 2.85,
  "transaction": {
    "id": "cm8tx126",
    "userId": "cm8user123",
    "txType": "SELL_PREDICTION",
    "assetId": null,
    "marketId": "cm8market123",
    "quantity": 2,
    "amountUsdc": 2.85,
    "txSignature": "4predictionSell11111111111111111111111111111",
    "createdAt": "2026-03-13T10:45:00.000Z"
  }
}
```

### POST /api/markets/claim/prepare

Builds an unsigned transaction for reward claim after market settlement.

Request body example with all supported fields:

```json
{
  "marketId": "cm8market123"
}
```

Success response:

```json
{
  "unsignedTx": "AQABAgMExampleBase64ClaimTransaction",
  "preview": {
    "marketId": "cm8market123",
    "winningSide": "TEAM_A",
    "winningAmount": 12,
    "payout": 44.6,
    "teamAName": "Team Spirit",
    "teamBName": "Falcons"
  }
}
```

### POST /api/markets/claim/confirm

Verifies the signed transaction and persists the reward claim.

Request body example with all supported fields:

```json
{
  "txSignature": "4claim111111111111111111111111111111111111",
  "marketId": "cm8market123"
}
```

Success response:

```json
{
  "message": "Rewards claimed",
  "payout": 44.6,
  "transaction": {
    "id": "cm8tx127",
    "userId": "cm8user123",
    "txType": "CLAIM_REWARD",
    "assetId": null,
    "marketId": "cm8market123",
    "quantity": 12,
    "amountUsdc": 44.6,
    "txSignature": "4claim111111111111111111111111111111111111",
    "createdAt": "2026-03-13T10:50:00.000Z"
  }
}
```

## User Route Endpoints

These routes are mounted separately under `/user`.

### GET /user/by-wallet/:walletAddress

Looks up a user by wallet address.

Success response when found:

```json
{
  "exists": true,
  "user": {
    "id": "cm8user123",
    "walletAddress": "9xQeWvG816bUx9EPjHmaT23yvVMR9hM1S9h8y5RzV5j",
    "username": "alphafan",
    "avatarUrl": null,
    "country": "India",
    "bio": "Esports fan and trader",
    "createdAt": "2026-03-13T10:00:00.000Z"
  }
}
```

Success response when not found:

```json
{
  "exists": false,
  "message": "No user"
}
```

### POST /user/signin

Legacy user signin route. This route signs a fixed message and issues a JWT.

Request body example with all supported fields:

```json
{
  "publicKey": "9xQeWvG816bUx9EPjHmaT23yvVMR9hM1S9h8y5RzV5j",
  "signature": "MEUCIQDbExampleBase64SignatureStringThatDecodesTo64Bytes=="
}
```

Success response example for an existing user:

```json
{
  "message": "existing",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.legacy.user.token"
}
```

Success response example for a new user:

```json
{
  "message": "non-existing",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.legacy.new.user.token"
}
```

### PUT /user/profile

Updates editable user profile fields.

Headers:

```http
Authorization: Bearer <jwt>
Content-Type: application/json
```

Request body example with all supported fields:

```json
{
  "username": "alphafan",
  "country": "India"
}
```

Success response:

```json
{
  "message": "Profile updated successfully",
  "user": {
    "id": "cm8user123",
    "walletAddress": "9xQeWvG816bUx9EPjHmaT23yvVMR9hM1S9h8y5RzV5j",
    "username": "alphafan",
    "avatarUrl": null,
    "country": "India",
    "bio": null,
    "createdAt": "2026-03-13T10:00:00.000Z"
  }
}
```

### GET /user/profile

Fetches the authenticated user's profile.

Headers:

```http
Authorization: Bearer <jwt>
```

Success response:

```json
{
  "message": "Profile fetched successfully",
  "user": {
    "id": "cm8user123",
    "walletAddress": "9xQeWvG816bUx9EPjHmaT23yvVMR9hM1S9h8y5RzV5j",
    "username": "alphafan",
    "avatarUrl": null,
    "country": "India",
    "bio": "Esports fan and trader",
    "createdAt": "2026-03-13T10:00:00.000Z"
  }
}
```

## Error Behavior Notes

Common error responses:

- `401 Unauthorized` when JWT is missing or invalid
- `403 Admin access required` for protected admin routes
- `404` for missing resources such as team, asset, match, or market
- `400` for invalid request body data or a transaction/memo mismatch
- `500` for unexpected backend failures

Common validation rules enforced in code:

- `assetId`, `marketId`, `matchId`, `teamAId`, `teamBId`, `name`, and `game` must be non-empty strings where required
- `quantity` must be a positive integer
- `basePrice`, `kFactor`, `initialLiquidity`, and `amount` must be positive numbers
- prediction `side` must be `TEAM_A` or `TEAM_B`
- result `winner` must be `TEAM_A` or `TEAM_B`

## Environment Variables

Important environment variables used by this backend:

- `JWT_SECRET`
- `AUTH_SIGN_MESSAGE`
- `DATABASE_URL`
- `SOLANA_RPC_URL`
- `PLATFORM_SIGNER_SECRET`
- `ADMIN_API_KEY`
- `ADMIN_WALLETS`
- `ADMIN_MINT_WALLET`
- ImageKit-related variables required by metadata upload flow

## Product Behavior Summary

### Team Asset Market

- Assets use a bonding curve
- Buying increases `circulating` supply and raises price
- Selling decreases `circulating` supply and lowers price
- Asset transfer is a real SPL token movement on devnet

### Prediction Market

- Users buy positions on `TEAM_A` or `TEAM_B`
- Market supply and liquidity are updated in the database after `confirm`
- Settlement occurs when admin posts the result
- Reward claims are proportional to winning-side ownership

### Idempotency

All `confirm` routes check for an existing `transaction` row with the same `txSignature` and `userId`.

That means repeated confirm calls for the same transaction will not duplicate state changes.
