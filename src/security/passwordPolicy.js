export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_REQUIREMENTS_TEXT = `Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters. Longer passphrases are encouraged.`;

export function passwordLengthError(password, { label = "Password" } = {}) {
    const length = typeof password === "string" ? password.length : 0;
    if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
        return `${label} must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`;
    }

    return null;
}

export function passwordPolicyLocals() {
    return {
        passwordMinLength: PASSWORD_MIN_LENGTH,
        passwordMaxLength: PASSWORD_MAX_LENGTH,
        passwordRequirements: PASSWORD_REQUIREMENTS_TEXT
    };
}
