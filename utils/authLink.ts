const User = require('../models/userModel');
const Company = require('../models/companyModel');
const { claimHoldingsForUser, signJwt } = require('./authShared');

const normalizeEmail = (value: any) => String(value || '').trim().toLowerCase();

/**
 * Shared find-or-link-or-create algorithm used by every passwordless auth
 * method (Google, Apple, email OTP). Given a normalized email:
 *   1. If a User already owns that email, link the provider id (if not
 *      already set to something else) and log them in.
 *   2. Else if a Company already owns that email, link the provider id and
 *      log them in as a Company actor.
 *   3. Else create a brand-new User (never a Company — company creation stays
 *      admin-only via POST /company) with profileCompleted:false so the
 *      client routes to profile completion.
 *
 * `provider` is 'google' | 'apple' | 'otp'. `providerId` is the Google `sub`
 * or Apple `sub` — omitted for 'otp'. `profileHints` carries opportunistic
 * data the provider handed us (display name / given+family name / avatar) to
 * pre-fill a brand-new account; never used to overwrite an existing user.
 */
const findOrLinkOrCreateByEmail = async ({ email, provider, providerId, profileHints }: any) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        const err: any = new Error('Email is required');
        err.statusCode = 400;
        throw err;
    }

    // 1. Existing User wins first — mobile app / web consumer accounts live here.
    const user = await User.findOne({ email: normalizedEmail });
    if (user) {
        let changed = false;
        if (provider === 'google' && !user.googleId) {
            user.googleId = providerId;
            user.isGoogleUser = true;
            changed = true;
        } else if (provider === 'apple' && !user.appleId) {
            user.appleId = providerId;
            changed = true;
        }
        if (!user.emailVerified) {
            user.emailVerified = true;
            changed = true;
        }
        if (changed) {
            await user.save();
        }
        await claimHoldingsForUser(user);
        const token = signJwt({ id: user._id, name: user.name, actorKind: 'User' });
        return { actorKind: 'User', actor: user, token, isNew: false };
    }

    // 2. Existing Company (brand/admin account) — link, never create.
    const company = await Company.findOne({ email: normalizedEmail });
    if (company) {
        let changed = false;
        if (provider === 'google' && !company.googleId) {
            company.googleId = providerId;
            changed = true;
        } else if (provider === 'apple' && !company.appleId) {
            company.appleId = providerId;
            changed = true;
        }
        if (!company.emailVerified) {
            company.emailVerified = true;
            changed = true;
        }
        if (changed) {
            await company.save();
        }
        const token = signJwt({ id: company._id, name: company.name, actorKind: 'Company' });
        return { actorKind: 'Company', actor: company, token, isNew: false };
    }

    // 3. No existing account for this email at all — self-serve create a User.
    // Only reachable for google/apple/otp; never creates a Company.
    const newUserData: any = {
        name: profileHints?.name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        role: 'User',
        userType: 'client',
        isApproved: false,
        profileCompleted: false,
        emailVerified: true
    };
    if (profileHints?.avatar) newUserData.avatar = profileHints.avatar;
    if (profileHints?.firstName) newUserData.firstName = profileHints.firstName;
    if (profileHints?.lastName) newUserData.lastName = profileHints.lastName;
    if (provider === 'google') {
        newUserData.googleId = providerId;
        newUserData.isGoogleUser = true;
    } else if (provider === 'apple') {
        newUserData.appleId = providerId;
    }

    const newUser = await User.create(newUserData);
    await claimHoldingsForUser(newUser);
    const token = signJwt({ id: newUser._id, name: newUser.name, actorKind: 'User' });
    return { actorKind: 'User', actor: newUser, token, isNew: true };
};

module.exports = {
    findOrLinkOrCreateByEmail,
    normalizeEmail
};
