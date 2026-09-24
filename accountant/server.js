import express from 'express'
const app = express()
const port = process.env.PORT || 3000

app.use(express.json())

// Express 5 cleanly catches errors thrown inside async functions natively!
app.get('/api/data', async (req, res) => {
  // Simulating an asynchronous database call
  const data = { status: "success", version: "Express 5.x" }
  res.json(data)
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
