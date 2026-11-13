const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config({
    path: './.env'
});

process.on('uncaughtException', err => {
    console.log('UNCAUGHT EXCEPTION!!! shutting down...');
    console.log(err.name, err.message);
    process.exit(1);
});

const app = require('./app');

// Ensure uploads directory exists on startup
const fs = require('fs');
const path = require('path');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory:', uploadsDir);
}


mongoose.connect(process.env.DATABASE,
    (err: any) => {
        if(err) throw err;
        console.log('connected to MongoDB')
    });
mongoose.connection.on('connected', () => {
    console.log('Connected to MongoDB');
    // Companies registered before company types existed get the default type.
    // Only touches companies without a type, so it is safe on every start.
    const Company = require('./models/companyModel');
    const { DEFAULT_COMPANY_TYPE } = require('./utils/companyTypes');
    Company.updateMany({ companyType: { $exists: false } }, { $set: { companyType: DEFAULT_COMPANY_TYPE } })
        .then((r: any) => {
            const n = r?.modifiedCount ?? r?.nModified ?? 0;
            if (n) console.log(`Set the default company type on ${n} older companies`);
        })
        .catch((err: any) => console.error('Company type backfill failed:', err));
    // One brand per company: merge extra brands and bring products in line.
    require('./utils/brandProfile').consolidateBrands()
        .then((r: any) => console.log(`Brand profiles: ${r.merged} extra brands archived, ${r.synced} products updated`))
        .catch((err: any) => console.error('Brand consolidation failed:', err));
});
mongoose.connection.on('error', (error: any) => {
    console.log(error);
});
// Start the server
// Hosting providers typically inject PORT; for local dev default to 5052 to avoid common clashes.
const port = process.env.PORT || 5052;
const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Application is running on port ${port}`);
});

const { Server } = require('socket.io');

const socketIo = new Server(server, {
    cors : {
        origin : '*'
    }
})

// @ts-ignore
global.io = socketIo;

socketIo.on('connection', (socket: any) => {
    console.log('A user connected');
  
    socket.on('disconnect', () => {
      console.log('User disconnected');
    });
  
    socket.on('message', (data: any) => {
      console.log('Received message:', data);
      socketIo.emit('message', data); // Broadcast message to all connected clients
    });
});

process.on('unhandledRejection', (err: any) => {
    console.log('UNHANDLED REJECTION!!!  shutting down ...');
    console.log(err.name, err.message);
    server.close(() => {
        process.exit(1);
    });
});