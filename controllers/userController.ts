const User = require('../models/userModel');
const Company = require('../models/companyModel');
const Product = require('../models/productModel');
const ScanRecord = require('../models/scanRecordModel');
const AppError = require('../utils/appError');
const { buildUserResponse, claimHoldingsForUser, signJwt } = require('../utils/authShared');
const AuthController = require('./authController');

const normalizeUsername = (value: any) => (typeof value === 'string' ? value.trim() : '');

const findExistingNormalUserByName = async (name: string) => {
    if (!name) {
        return null;
    }
    return User.findOne({
        role: 'User',
        userType: { $in: ['client', 'agent'] },
        name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    });
};

/**
 * Admin-only endpoint that returns all users and companies.
 * Supports optional status filter: 'approved' | 'waiting'.
 * NOTE: Authentication/authorization is expected to be handled at a higher layer.
 */
exports.getAdminUserData = async (req: any, res: any, next: any) => {
    try {
        const status = req.query.status;

        const userFilter: any = {};
        if (status === 'approved') userFilter.isApproved = true;
        if (status === 'waiting') userFilter.isApproved = false;

        const users = await User.find(userFilter).sort({ isApproved: -1 });
        const companies = await Company.find().sort({ isVerified: -1 });

        // Per-company analytics: products uploaded, total scans of those products,
        // and how many distinct users scanned them.
        const productCounts = await Product.aggregate([
            { $match: { is_deleted: { $ne: true } } },
            { $group: { _id: '$company_id', count: { $sum: 1 } } }
        ]);
        const productCountMap: any = {};
        productCounts.forEach((p: any) => { if (p._id) productCountMap[String(p._id)] = p.count; });

        const scanCounts = await ScanRecord.aggregate([
            { $lookup: { from: 'products', localField: 'product_id', foreignField: '_id', as: 'p' } },
            { $unwind: '$p' },
            { $group: { _id: '$p.company_id', scans: { $sum: 1 }, users: { $addToSet: '$user_id' } } }
        ]);
        const scanCountMap: any = {};
        scanCounts.forEach((s: any) => {
            if (s._id) {
                scanCountMap[String(s._id)] = {
                    scans: s.scans,
                    uniqueScanners: (s.users || []).filter(Boolean).length
                };
            }
        });

        const companiesEnriched = companies.map((c: any) => {
            const obj = typeof c.toObject === 'function' ? c.toObject() : c;
            const id = String(obj._id);
            return {
                ...obj,
                productCount: productCountMap[id] || 0,
                scanCount: scanCountMap[id]?.scans || 0,
                uniqueScannerCount: scanCountMap[id]?.uniqueScanners || 0
            };
        });

        res.status(200).json({
            status: 'success',
            results: {
                users: users.length,
                companies: companies.length
            },
            data: {
                users,
                companies: companiesEnriched
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.approveUser = async (req: any, res: any, next: any) => {
    try {
        const doc = await User.findByIdAndUpdate(
            req.params.id,
            { isApproved: true },
            { new: true, runValidators: true }
        );

        if (!doc) {
            return next(new AppError(404, 'fail', 'No user found with that id'), req, res, next);
        }

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.deleteUser = async (req: any, res: any, next: any) => {
    try {
        const doc = await User.findByIdAndDelete(req.params.id);

        if (!doc) {
            return next(new AppError(404, 'fail', 'No user found with that id'), req, res, next);
        }

        res.status(204).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        next(error);
    }
};

exports.updateUser = async (req: any, res: any, next: any) => {
    try {
        const doc = await User.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        if (!doc) {
            return next(new AppError(404, 'fail', 'No user found with that id'), req, res, next);
        }

        res.status(200).json({
            status: 'success',
            data: {
                doc
            }
        });
    } catch (error) {
        next(error);
    }
};

// @deprecated Password-based login. Superseded by passwordless auth
// (/auth/google, /auth/apple, /auth/otp/*) — kept mounted so already-installed
// app builds don't hard-break mid-rollout. Do not build new features on this.
// Mobile app login endpoint - uses User table
exports.login = async (req: any, res: any, next: any) => {
    try {
        const { name, password } = req.body;

        if (!name || !password) {
            return res.status(400).json({
                status: 'fail',
                message: 'Please provide name and password'
            });
        }

        // Find user in User collection (for mobile app users)
        const user = await User.findOne({ name, password });

        if (!user) {
            return res.status(401).json({
                status: 'fail',
                message: 'Invalid credentials'
            });
        }

        // Claim any products transferred to this user's email before they registered.
        await claimHoldingsForUser(user);

        // Generate JWT token
        const token = signJwt({ id: user._id, name: user.name, actorKind: 'User' });

        const userData = buildUserResponse(user);

        res.status(200).json({
            status: 'success',
            token,
            user: userData
        });
    } catch (error) {
        next(error);
    }
};

exports.checkUsername = async (req: any, res: any, next: any) => {
    try {
        const name = normalizeUsername(req.body?.name);

        if (!name) {
            return res.status(400).json({
                status: 'fail',
                message: 'Please provide username'
            });
        }

        const existingUser = await findExistingNormalUserByName(name);
        return res.status(200).json({
            status: 'success',
            exists: !!existingUser
        });
    } catch (error) {
        next(error);
    }
};

// @deprecated Password-based registration. Superseded by passwordless auth
// (/auth/google, /auth/apple, /auth/otp/* + /auth/profile/complete) — kept
// mounted so already-installed app builds don't hard-break mid-rollout.
// Mobile app register endpoint - uses User table
exports.register = async (req: any, res: any, next: any) => {
    try {
        const {
            name,
            email,
            password,
            userType = 'client',
            gender,
            age,
            country,
            firstName,
            lastName,
            addressStreet,
            addressCity,
            addressState,
            addressZipCode,
            addressCountry,
            phoneNumber,
            dateOfBirth
        } = req.body;

        const normalizedName = normalizeUsername(name);

        if (!normalizedName || !password) {
            return res.status(400).json({
                status: 'fail',
                message: 'Please provide username and password'
            });
        }

        if (userType === 'client') {
            if (!gender || !age || !country) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Client requires gender, age, and country'
                });
            }
        } else if (userType === 'agent') {
            if (!email || !firstName || !lastName || !addressStreet || !addressCity || !addressState || !addressZipCode || !addressCountry || !phoneNumber || !gender || !dateOfBirth) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Agent requires email, first name, last name, street, city, state, zip code, country, phone number, gender, and date of birth'
                });
            }
        } else {
            return res.status(400).json({
                status: 'fail',
                message: 'Invalid user type'
            });
        }

        const existingUserByName = await findExistingNormalUserByName(normalizedName);
        if (existingUserByName) {
            return res.status(400).json({
                status: 'fail',
                message: 'User with this name or email already exists'
            });
        }

        const duplicateQuery: any[] = [];
        if (email) {
            duplicateQuery.push({ email });
        }

        const existingUser = duplicateQuery.length
            ? await User.findOne({
                role: 'User',
                $or: duplicateQuery
            })
            : null;

        if (existingUser) {
            return res.status(400).json({
                status: 'fail',
                message: 'User with this name or email already exists'
            });
        }

        // Create new user in User collection (for mobile app)
        const newUser = await User.create({
            name: normalizedName,
            email,
            password,
            userType,
            gender,
            age,
            country,
            firstName,
            lastName,
            addressStreet,
            addressCity,
            addressState,
            addressZipCode,
            addressCountry,
            address: `${addressStreet}, ${addressCity}, ${addressState}, ${addressZipCode}, ${addressCountry}`,
            phoneNumber,
            dateOfBirth,
            role: 'User',
            isApproved: false,
            profileCompleted: true
        });

        // Claim any products transferred to this email while the receiver was unregistered.
        await claimHoldingsForUser(newUser);

        // Generate JWT token
        const token = signJwt({ id: newUser._id, name: newUser.name, actorKind: 'User' });

        const userData = buildUserResponse(newUser);

        res.status(201).json({
            status: 'success',
            token,
            user: userData,
            message: 'User registered successfully'
        });
    } catch (error) {
        next(error);
    }
};

// @deprecated Google OAuth login endpoint. Superseded by POST /auth/google.
// Delegates to the same verified-ID-token path — this endpoint used to trust
// a client-supplied Google *access* token via a raw, unauthenticated fetch to
// Google's userinfo endpoint (no audience/signature verification), which was
// a real vulnerability. It now requires the same `idToken` body field and
// verified-signature/audience check as /auth/google. Kept mounted only so
// already-installed app builds don't hard-break mid-rollout; clients should
// migrate to /auth/google.
exports.googleLogin = (req: any, res: any, next: any) => {
    // Best-effort compat: some older builds may post the token under
    // `accessToken`. Remapping the field name does not reintroduce the old
    // vulnerability — verifyIdToken() still cryptographically verifies the
    // value as a signed Google ID token and rejects anything else (including
    // a real OAuth access token, which isn't a JWT at all).
    if (!req.body.idToken && req.body.accessToken) {
        req.body.idToken = req.body.accessToken;
    }
    return AuthController.google(req, res, next);
};

// @deprecated Complete Google profile endpoint. Superseded by
// POST /auth/profile/complete (JWT-authenticated, works for Google/Apple/OTP
// signups alike). Kept mounted so already-installed app builds don't
// hard-break mid-rollout.
// Complete Google profile endpoint
exports.completeGoogleProfile = async (req: any, res: any, next: any) => {
    try {
        const { userId, userType, username, gender, age, country } = req.body;

        if (!userId) {
            return res.status(400).json({
                status: 'fail',
                message: 'User ID is required'
            });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'User not found'
            });
        }

        if (!username || !gender || !age || !country) {
            return res.status(400).json({
                status: 'fail',
                message: 'Please provide username, gender, age, and country'
            });
        }

        user.name = username;
        user.userType = userType || 'client';
        user.gender = gender;
        user.age = age;
        user.country = country;
        user.profileCompleted = true;
        await user.save();

        // Generate new JWT token
        const token = signJwt({ id: user._id, name: user.name, actorKind: 'User' });

        const userData = buildUserResponse(user);

        res.status(200).json({
            status: 'success',
            token,
            user: userData,
            message: 'Profile completed successfully'
        });
    } catch (error) {
        next(error);
    }
};

// Update profile endpoint for mobile app profile edit page
exports.updateProfile = async (req: any, res: any, next: any) => {
    try {
        const { userType } = req.body;
        const updateData: any = {};

        if (!userType || !['client', 'agent'].includes(userType)) {
            return res.status(400).json({
                status: 'fail',
                message: 'Invalid user type'
            });
        }

        if (userType === 'client') {
            const { name, password, gender, age, country } = req.body;
            if (!name || !password || !gender || !age || !country) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Client requires username, password, gender, age, and country'
                });
            }
            updateData.name = name;
            updateData.password = password;
            updateData.gender = gender;
            updateData.age = age;
            updateData.country = country;
            updateData.firstName = undefined;
            updateData.lastName = undefined;
            updateData.address = undefined;
            updateData.addressStreet = undefined;
            updateData.addressCity = undefined;
            updateData.addressState = undefined;
            updateData.addressZipCode = undefined;
            updateData.addressCountry = undefined;
            updateData.phoneNumber = undefined;
            updateData.dateOfBirth = undefined;
        } else {
            const {
                name,
                email,
                firstName,
                lastName,
                addressStreet,
                addressCity,
                addressState,
                addressZipCode,
                addressCountry,
                phoneNumber,
                gender,
                dateOfBirth,
                password
            } = req.body;
            if (!name || !email || !firstName || !lastName || !addressStreet || !addressCity || !addressState || !addressZipCode || !addressCountry || !phoneNumber || !gender || !dateOfBirth) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Agent requires username, email, first name, last name, street, city, state, zip code, country, phone number, gender, and date of birth'
                });
            }
            updateData.name = name;
            updateData.email = email;
            updateData.firstName = firstName;
            updateData.lastName = lastName;
            updateData.addressStreet = addressStreet;
            updateData.addressCity = addressCity;
            updateData.addressState = addressState;
            updateData.addressZipCode = addressZipCode;
            updateData.addressCountry = addressCountry;
            updateData.address = `${addressStreet}, ${addressCity}, ${addressState}, ${addressZipCode}, ${addressCountry}`;
            updateData.phoneNumber = phoneNumber;
            updateData.gender = gender;
            updateData.dateOfBirth = dateOfBirth;
            if (password) {
                updateData.password = password;
            }
            updateData.age = undefined;
            updateData.country = undefined;
        }

        updateData.userType = userType;
        updateData.profileCompleted = true;

        const user = await User.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
            runValidators: true
        });

        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'User not found'
            });
        }

        const token = signJwt({ id: user._id, name: user.name, actorKind: 'User' });

        res.status(200).json({
            status: 'success',
            token,
            user: buildUserResponse(user),
            message: 'Profile updated successfully'
        });
    } catch (error) {
        next(error);
    }
};
