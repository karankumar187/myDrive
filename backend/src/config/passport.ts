import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { IUserDocument } from '../types/index.js';

export function configurePassport(): void {
  const clientID = process.env.GOOGLE_AUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_AUTH_CLIENT_SECRET;
  const callbackURL = process.env.GOOGLE_AUTH_CALLBACK_URL || 'http://localhost:5000/api/v1/auth/google/callback';

  if (!clientID || !clientSecret || clientID === 'mock_google_auth_client_id') {
    console.warn('⚠️ Google Auth credentials not configured or set to mock. Passport will register fallback handler.');
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: clientID || 'dummy_id',
        clientSecret: clientSecret || 'dummy_secret',
        callbackURL,
        passReqToCallback: true,
      },
      async (_req, _accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('No email found in Google profile'), undefined);
          }

          // Find or create User - strictly app user identity
          let user = await User.findOne({ googleProfileId: profile.id });

          if (!user) {
            // Check if user exists by email (link account)
            user = await User.findOne({ email: email.toLowerCase() });
            if (user) {
              user.googleProfileId = profile.id;
              if (profile.photos?.[0]?.value && !user.avatarUrl) {
                user.avatarUrl = profile.photos[0].value;
              }
              await user.save();
            } else {
              user = await User.create({
                googleProfileId: profile.id,
                email: email.toLowerCase(),
                name: profile.displayName || email.split('@')[0],
                avatarUrl: profile.photos?.[0]?.value || '',
                role: 'owner',
              });
            }
          }

          return done(null, user);
        } catch (error) {
          return done(error as Error, undefined);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user._id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });
}

export function generateUserJwt(user: IUserDocument): string {
  const secret = process.env.JWT_SECRET || 'fallback_secret_key_drive';
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

  return jwt.sign(
    {
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    },
    secret,
    { expiresIn: expiresIn as any }
  );
}
