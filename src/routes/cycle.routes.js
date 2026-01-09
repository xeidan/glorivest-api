const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  startCycle,
  stopCycle
} = require('../services/investmentCycle.service');

router.post('/start', auth, async (req, res) => {
  try {
    const { walletId, expectedProfit } = req.body;

    const cycle = await startCycle({
      userId: req.user.id,
      walletId,
      expectedProfit
    });

    res.json({ cycle });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/stop', auth, async (req, res) => {
  try {
    const { walletId } = req.body;

    const cycle = await stopCycle({
      userId: req.user.id,
      walletId
    });

    res.json({ cycle });
  } catch (err) {
  console.error(err);
  res.status(500).json({
    message: 'Server error',
    error: err.message
  });
}
});


router.get('/current', auth, async (req, res) => {
  try {
    const { walletId } = req.query;
    if (!walletId) {
      return res.status(400).json({ error: 'walletId is required' });
    }

    const cycle = await getCurrentCycle({
      userId: req.user.id,
      walletId,
    });

    if (!cycle) {
      return res.json({ cycle: null });
    }

    res.json({ cycle });
  } catch (err) {
    console.error('get current cycle error', err);
    res.status(500).json({ error: 'Server error' });
  }
});


module.exports = router;
