require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

// --- DATABASE MODELS ---
const connectDB = require('./config/db');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');

// ANTI-CHEAT AUDIT LOG SCHEMA
const StockLogSchema = new mongoose.Schema({
    item_name: String,
    qty_added: Number,
    cashier_name: String,
    createdAt: { type: Date, default: Date.now }
});
const StockLog = mongoose.model('StockLog', StockLogSchema);

// EXPENDITURE SCHEMA
const ExpenditureSchema = new mongoose.Schema({
    description: String,
    amount: Number,
    added_by: String,
    date: { type: Date, default: Date.now }
});
const Expenditure = mongoose.model('Expenditure', ExpenditureSchema);

// 1. Connect to Database
connectDB();

// ==========================================
// 2. CENTRAL API & CASHIER SERVER (PORT 4025)
// ==========================================
const API_PORT = process.env.PORT || 4025;
const STORE_ID = 'Favoured Electronics';

const apiApp = express();
apiApp.use(cors());
apiApp.use(express.json());
apiApp.use(express.urlencoded({ extended: true }));

// ==========================================
// --- API ROUTES ---
// ==========================================

// ------------------------------------------
// AUTHENTICATION
// ------------------------------------------
apiApp.post('/api/login', async (req, res) => {
    const { username, pin, attemptedRole } = req.body;
    try {
        const user = await User.findOne({ username, pin_hash: pin });
        if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        if (user.isActive === false && user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Account suspended. Contact Admin.' });
        }
        if (user.role === attemptedRole || user.role === 'admin') {
            res.json({ success: true, token: 'temp-auth-token', role: user.role });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials or wrong portal' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ------------------------------------------
// USER MANAGEMENT (Admin & Cashier only)
// ------------------------------------------
apiApp.get('/api/staff', async (req, res) => {
    try {
        const staff = await User.find({ role: { $in: ['admin', 'cashier'] } }, '-pin_hash').sort({ createdAt: -1 });
        res.json({ success: true, staff });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

apiApp.post('/api/staff', async (req, res) => {
    try {
        const { username, role, pin } = req.body;
        if (!['admin','cashier'].includes(role)) return res.status(400).json({ success: false, message: 'Invalid role' });
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ success: false, message: 'Username already exists' });
        const newUser = await User.create({ username, role, pin_hash: pin });
        res.json({ success: true, message: 'User added successfully!', user: newUser });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add user' });
    }
});

apiApp.patch('/api/staff/:id/edit', async (req, res) => {
    try {
        const { username, isActive } = req.body;
        const updateData = {};
        if (username !== undefined) updateData.username = username;
        if (isActive !== undefined) updateData.isActive = isActive;
        const updatedUser = await User.findByIdAndUpdate(req.params.id, updateData, { new: true });
        res.json({ success: true, user: updatedUser });
    } catch (error) {
        res.status(500).json({ success: false, message: `Failed to update: ${error.message}` });
    }
});

apiApp.patch('/api/staff/:id/password', async (req, res) => {
    try {
        const { newPin } = req.body;
        await User.findByIdAndUpdate(req.params.id, { pin_hash: newPin });
        res.json({ success: true, message: 'Password updated successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update password' });
    }
});

apiApp.delete('/api/staff/:id', async (req, res) => {
    try {
        const userToDelete = await User.findById(req.params.id);
        if (userToDelete && userToDelete.username === 'admin') {
            return res.status(400).json({ success: false, message: 'Cannot delete the main admin account!' });
        }
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'User deleted successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
});

// ------------------------------------------
// EXPENDITURES
// ------------------------------------------
apiApp.get('/api/expenditures', async (req, res) => {
    try {
        const expenses = await Expenditure.find({}).sort({ date: -1 });
        res.json({ success: true, expenses });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.post('/api/expenditures', async (req, res) => {
    try {
        const { description, amount, added_by } = req.body;
        const newExpense = await Expenditure.create({ description, amount: Number(amount), added_by: added_by || 'Admin' });
        res.json({ success: true, expense: newExpense });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ------------------------------------------
// PRODUCTS, INVENTORY & AUDIT LOGS
// ------------------------------------------
apiApp.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find({});
        res.json({ success: true, products });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch products' });
    }
});

apiApp.post('/api/products', async (req, res) => {
    try {
        const { name, type, price, buying_price, stock, image } = req.body;
        const newProduct = await Product.create({
            name,
            type: (type || 'others').toLowerCase(),
            price: Number(price) || 0,
            buying_price: Number(buying_price) || 0,
            stock: Number(stock) || 0,
            image: image || null
        });
        res.json({ success: true, message: 'Product created!', product: newProduct });
    } catch (error) {
        console.error('Error creating product:', error);
        res.status(500).json({ success: false, message: `DB Error: ${error.message}` });
    }
});

apiApp.patch('/api/products/:id', async (req, res) => {
    try {
        const { price, buying_price, addedStock, cashierName, image, name } = req.body;
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
        if (price !== undefined && price !== '') product.price = Number(price);
        if (buying_price !== undefined && buying_price !== '') product.buying_price = Number(buying_price);
        if (image !== undefined) product.image = image;
        if (name !== undefined) product.name = name;
        if (addedStock && Number(addedStock) > 0) {
            product.stock = (product.stock || 0) + Number(addedStock);
            await StockLog.create({ item_name: product.name, qty_added: Number(addedStock), cashier_name: cashierName || "Unknown" });
        }
        await product.save();
        res.json({ success: true, message: 'Inventory updated', product });
    } catch (error) {
        res.status(500).json({ success: false, message: `Failed to update inventory: ${error.message}` });
    }
});

apiApp.delete('/api/products/:id', async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Product deleted!' });
    } catch (error) {
        res.status(500).json({ success: false, message: `DB Error: ${error.message}` });
    }
});

apiApp.get('/api/stock-logs', async (req, res) => {
    try {
        const logs = await StockLog.find().sort({ createdAt: -1 }).limit(50);
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.delete('/api/stock-logs/:id', async (req, res) => {
    try {
        await StockLog.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Stock alert deleted!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

apiApp.get('/api/products/wipe-test-data', async (req, res) => {
    try {
        await Product.deleteMany({});
        res.json({ success: true, message: 'All products wiped permanently!' });
    } catch (error) {
        res.status(500).json({ success: false, message: `DB Error: ${error.message}` });
    }
});

// ------------------------------------------
// ORDERS
// ------------------------------------------
apiApp.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find({}).sort({ createdAt: -1 });
        res.json({ success: true, orders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
});

apiApp.post('/api/orders', async (req, res) => {
    try {
        const { items, total_amount, served_by, customer_name, payment_method, mpesa_receipt, mpesa_amount, cash_tendered, cash_change } = req.body;
        const adminUser = await User.findOne({ username: 'admin' });
        const newOrder = await Order.create({
            user_id: adminUser ? adminUser._id : null,
            table_number: 'Walk-in',
            items: items,
            total_amount: total_amount,
            status: 'completed',
            served_by: served_by || 'Cashier',
            customer_name: customer_name || 'WALK-IN',
            payment_method: payment_method || 'cash',
            mpesa_receipt: mpesa_receipt || null,
            mpesa_amount: mpesa_amount || 0,
            cash_tendered: cash_tendered || 0,
            cash_change: cash_change || 0
        });
        if (items && items.length > 0) {
            for (let item of items) {
                if (item.product_id) {
                    await Product.findByIdAndUpdate(item.product_id, { $inc: { stock: -item.quantity } });
                }
            }
        }
        res.json({ success: true, order: newOrder });
    } catch (error) {
        res.status(500).json({ success: false, message: `Failed to save order: ${error.message}` });
    }
});

// ------------------------------------------
// DAILY SALES ENDPOINT
// ------------------------------------------
apiApp.get('/api/sales/today', async (req, res) => {
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);
    try {
        const orders = await Order.find({ createdAt: { $gte: start, $lte: end }, status: 'completed' });
        const totalSales = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
        let cashSales = 0, mpesaSales = 0;
        orders.forEach(o => {
            if (o.payment_method === 'mpesa') {
                mpesaSales += (o.total_amount || 0);
            } else if (o.payment_method === 'split') {
                const mpesaPart = o.mpesa_amount || 0;
                mpesaSales += mpesaPart;
                cashSales += (o.total_amount || 0) - mpesaPart;
            } else {
                cashSales += (o.total_amount || 0);
            }
        });
        const orderCount = orders.length;
        res.json({ success: true, totalSales, cashSales, mpesaSales, orderCount, orders });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ------------------------------------------
// SERVE CASHIER FRONTEND
// ------------------------------------------
apiApp.use(express.static(path.join(__dirname, 'public/cashier')));

apiApp.listen(API_PORT, '0.0.0.0', () => {
    console.log(`${STORE_ID} API & Cashier running on port ${API_PORT}`);
});

// ==========================================
// 3. ADMIN FRONTEND SERVER (PORT 4026)
// ==========================================
const adminApp = express();
adminApp.use(cors());
adminApp.use(express.static(path.join(__dirname, 'public/admin')));
adminApp.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});
adminApp.listen(4026, '0.0.0.0', () => {
    console.log(`${STORE_ID} Admin Portal running on port 4026`);
});
