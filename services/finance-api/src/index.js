const express = require('express');
const cors = require('cors');
const webhookRoutes = require('./routes/webhook');
const transactionRoutes = require('./routes/transactions');
const { startRecurringScheduler } = require('./services/schedulerService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/bot', webhookRoutes);
app.use('/transactions', transactionRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'finance-api', timestamp: new Date() });
});

app.listen(PORT, () => {
  console.log(`Finance API running on port ${PORT}`);
  // Inisialisasi scheduler automasi gajian
  startRecurringScheduler();
});

