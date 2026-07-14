const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const User = require('../models/userModel');
const Company = require('../models/companyModel');
const AppError = require('../utils/appError');
const { buildUserResponse, buildCompanyResponse, signJwt } = require('../utils/authShared');
const { findOrLinkOrCreateByEmail, normalizeEmail } = require('../utils/authLink');
const { generateOtp, sendOtpEmail } = require('../utils/otp');

const normalizeUsername = (value: any) => (typeof value === 'string' ? value.trim() : '');

/** Shared response envelope for google/apple/otpVerify — mirrors the shape
 * the legacy /user/google-login endpoint returned, plus an actorKind field. */
const sendAuthResponse = (res: any, result: any) => {
    const { actorKind, actor, token } = result;
    const data = actorKind === 'Company' ? buildCompanyResponse(actor) : buildUserResponse(actor);
    const message = actorKind === 'User' && !actor.profileCompleted
        ? 'Profile completion required'
        : 'Login successful';

    return res.status(200).json({
        status: 'success',
        token,
        user: data,
        actorKind,
        message
    });
};

// POST /auth/google — verifies a Google ID token (not a client-supplied access
// token) via google-auth-library, then finds/links/creates the matching
// User or Company by email.
exports.google = async (req: any, res: any, next: any) => {
    try {
        const { idToken } = req.body || {};
        if (!idToken) {
            return res.status(400).json({ status: 'fail', message: 'idToken is required' });
        }

        const clientIds = [
            process.env.GOOGLE_WEB_CLIENT_ID,
            process.env.GOOGLE_ANDROID_CLIENT_ID,
            process.env.GOOGLE_IOS_CLIENT_ID
        ].filter(Boolean);

        if (!clientIds.length) {
            return next(new AppError(500, 'error', 'Google sign-in is not configured'));
        }

        const client = new OAuth2Client();
        let ticket;
        try {
            ticket = await client.verifyIdToken({ idToken, audience: clientIds });
        } catch (err) {
            return res.status(401).json({ status: 'fail', message: 'Invalid Google ID token' });
        }

        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
            return res.status(401).json({ status: 'fail', message: 'Google token did not include an email' });
        }

        const result = await findOrLinkOrCreateByEmail({
            email: payload.email,
            provider: 'google',
            providerId: payload.sub,
            profileHints: {
                name: payload.name,
                firstName: payload.given_name,
                lastName: payload.family_name,
                avatar: payload.picture
            }
        });

        return sendAuthResponse(res, result);
    } catch (error) {
        next(error);
    }
};

// POST /auth/apple — verifies an Apple identityToken via apple-signin-auth.
// Apple only sends the user's name on the very first authorization (from the
// client, not the token), so we accept it opportunistically for new accounts.
exports.apple = async (req: any, res: any, next: any) => {
    try {
        const { identityToken, user } = req.body || {};
        if (!identityToken) {
            return res.status(400).json({ status: 'fail', message: 'identityToken is required' });
        }

        const audience = String(process.env.APPLE_CLIENT_ID || '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);

        if (!audience.length) {
            return next(new AppError(500, 'error', 'Apple sign-in is not configured'));
        }

        let applePayload: any;
        try {
            applePayload = await appleSignin.verifyIdToken(identityToken, {
                audience,
                ignoreExpiration: false
            });
        } catch (err) {
            return res.status(401).json({ status: 'fail', message: 'Invalid Apple identity token' });
        }

        if (!applePayload || !applePayload.email) {
            return res.status(401).json({ status: 'fail', message: 'Apple token did not include an email' });
        }

        const firstName = user?.firstName;
        const lastName = user?.lastName;
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

        const result = await findOrLinkOrCreateByEmail({
            email: applePayload.email,
            provider: 'apple',
            providerId: applePayload.sub,
            profileHints: {
                name: fullName || undefined,
                firstName,
                lastName
            }
        });

        return sendAuthResponse(res, result);
    } catch (error) {
        next(error);
    }
};

/** Locate the User or Company document (if any) currently holding OTP state
 * for this email — used by both otpRequest and otpVerify. */
const findOtpOwner = async (email: string) => {
    let owner = await User.findOne({ email }).select('+otpCode +otpExpiresAt +otpAttempts +otpResendAt');
    if (owner) {
        return { owner, actorKind: 'User' };
    }
    owner = await Company.findOne({ email }).select('+otpCode +otpExpiresAt +otpAttempts +otpResendAt');
    if (owner) {
        return { owner, actorKind: 'Company' };
    }
    return { owner: null, actorKind: null };
};

// POST /auth/otp/request — generates and emails a 6-digit code, with a
// 60-second per-email resend cooldown (in addition to the route's IP rate
// limiter, which doesn't catch NAT-sharing users on the same code request).
exports.otpRequest = async (req: any, res: any, next: any) => {
    try {
        const email = normalizeEmail(req.body?.email);
        if (!email) {
            return res.status(400).json({ status: 'fail', message: 'email is required' });
        }

        const { owner: existingOwner } = await findOtpOwner(email);

        if (existingOwner && existingOwner.otpResendAt && existingOwner.otpResendAt.getTime() > Date.now()) {
            return res.status(429).json({ status: 'fail', message: 'Please wait before requesting another code' });
        }

        const code = generateOtp();
        const now = Date.now();
        const otpFields = {
            otpCode: code,
            otpExpiresAt: new Date(now + 10 * 60 * 1000),
            otpResendAt: new Date(now + 60 * 1000),
            otpAttempts: 0
        };

        let owner = existingOwner;
        if (owner) {
            Object.assign(owner, otpFields);
            await owner.save();
        } else {
            // No User or Company owns this email yet. Create a minimal User shell
            // to hold OTP state — otpVerify will find this same document (never a
            // duplicate), and profileCompleted stays false so the client routes to
            // profile completion after a successful verify.
            owner = await User.create({
                name: email.split('@')[0],
                email,
                role: 'User',
                userType: 'client',
                isApproved: false,
                profileCompleted: false,
                emailVerified: false,
                ...otpFields
            });
        }

        try {
            await sendOtpEmail(email, code);
        } catch (err) {
            console.error('sendOtpEmail failed:', err);
            return next(new AppError(502, 'fail', 'Failed to send verification email'));
        }

        // Dev convenience only — never log OTP codes outside local/dev.
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[dev-only] OTP code for ${email}: ${code}`);
        }

        return res.status(200).json({ message: 'Code sent' });
    } catch (error) {
        next(error);
    }
};

// POST /auth/otp/verify — validates the code (5 wrong attempts invalidates it
// entirely, forcing a fresh /auth/otp/request), then finds/links/creates the
// matching User or Company by email via the shared helper.
exports.otpVerify = async (req: any, res: any, next: any) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const code = String(req.body?.code || '').trim();
        if (!email || !code) {
            return res.status(400).json({ status: 'fail', message: 'email and code are required' });
        }

        const { owner } = await findOtpOwner(email);

        if (!owner || !owner.otpCode || !owner.otpExpiresAt) {
            return res.status(400).json({ status: 'fail', message: 'No pending code for this email. Request a new one.' });
        }

        if (owner.otpExpiresAt.getTime() < Date.now()) {
            owner.otpCode = undefined;
            owner.otpExpiresAt = undefined;
            owner.otpAttempts = 0;
            owner.otpResendAt = undefined;
            await owner.save();
            return res.status(400).json({ status: 'fail', message: 'Code expired. Request a new one.' });
        }

        if (owner.otpCode !== code) {
            owner.otpAttempts = (owner.otpAttempts || 0) + 1;
            if (owner.otpAttempts >= 5) {
                owner.otpCode = undefined;
                owner.otpExpiresAt = undefined;
                owner.otpAttempts = 0;
                owner.otpResendAt = undefined;
                await owner.save();
                return res.status(400).json({ status: 'fail', message: 'Too many attempts. Request a new code.' });
            }
            await owner.save();
            return res.status(400).json({ status: 'fail', message: 'Invalid code' });
        }

        // Correct code.
        owner.otpCode = undefined;
        owner.otpExpiresAt = undefined;
        owner.otpAttempts = 0;
        owner.otpResendAt = undefined;
        owner.emailVerified = true;
        await owner.save();

        const result = await findOrLinkOrCreateByEmail({ email, provider: 'otp' });
        return sendAuthResponse(res, result);
    } catch (error) {
        next(error);
    }
};

// POST /auth/profile/complete — requires a valid JWT (req.user set by the
// `protect` middleware). Generalizes the old Google-only completeGoogleProfile
// flow to all 3 passwordless auth methods.
exports.completeProfile = async (req: any, res: any, next: any) => {
    try {
        if (!req.user || req.user.actorKind !== 'User') {
            return next(new AppError(403, 'fail', 'Only user accounts can complete a profile here'));
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return next(new AppError(404, 'fail', 'User not found'));
        }

        const {
            name,
            nickname,
            email,
            gender,
            birthYear,
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
        } = req.body || {};
        const userType = req.body?.userType || user.userType || 'client';

        if (userType === 'client') {
            // GDPR data minimization: consumers provide exactly nickname/gender/
            // birthYear/country — no name, email, or phone number is ever required here.
            const birthYearNum = Number(birthYear);
            if (!nickname || !gender || !birthYear || !country || Number.isNaN(birthYearNum) || String(birthYear).length !== 4) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Client requires nickname, gender, birthYear (4-digit year), and country'
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
            return res.status(400).json({ status: 'fail', message: 'Invalid user type' });
        }

        if (name) {
            const normalizedName = normalizeUsername(name);
            if (normalizedName) user.name = normalizedName;
        }
        if (email) {
            user.email = normalizeEmail(email);
        }

        user.userType = userType;
        user.gender = gender;

        if (userType === 'client') {
            user.nickname = normalizeUsername(nickname);
            user.birthYear = Number(birthYear);
            user.country = country;
        } else {
            user.firstName = firstName;
            user.lastName = lastName;
            user.addressStreet = addressStreet;
            user.addressCity = addressCity;
            user.addressState = addressState;
            user.addressZipCode = addressZipCode;
            user.addressCountry = addressCountry;
            user.address = `${addressStreet}, ${addressCity}, ${addressState}, ${addressZipCode}, ${addressCountry}`;
            user.phoneNumber = phoneNumber;
            user.dateOfBirth = dateOfBirth;
        }

        user.profileCompleted = true;
        await user.save();

        const token = signJwt({ id: user._id, name: user.name, actorKind: 'User' });

        return res.status(200).json({
            status: 'success',
            token,
            user: buildUserResponse(user),
            actorKind: 'User',
            message: 'Profile completed successfully'
        });
    } catch (error) {
        next(error);
    }
};

// POST /auth/device-token — requires a valid JWT. Registers the Expo/FCM push
// token as the sole channel used to reach a consumer, per the GDPR brief
// ("Device Token obtained here will be the only key to communicate with the user").
exports.registerDeviceToken = async (req: any, res: any, next: any) => {
    try {
        if (!req.user || req.user.actorKind !== 'User') {
            return next(new AppError(403, 'fail', 'Only user accounts can register a device token'));
        }

        const deviceToken = String(req.body?.deviceToken || '').trim();
        if (!deviceToken) {
            return res.status(400).json({ status: 'fail', message: 'deviceToken is required' });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return next(new AppError(404, 'fail', 'User not found'));
        }

        user.deviceToken = deviceToken;
        user.pushConsent = true;
        await user.save();

        return res.status(200).json({ status: 'success', message: 'Device token registered' });
    } catch (error) {
        next(error);
    }
};
