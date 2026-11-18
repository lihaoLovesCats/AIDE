const express = require('express')
const app = express()
app.get('/', (_req, res) => res.send('plain-demo ok'))
app.listen(process.env.PORT || 3000)
