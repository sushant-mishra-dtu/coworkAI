import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

# Load the root .env file specifically to ensure we read the main ENCRYPTION_KEY
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
load_dotenv(dotenv_path=env_path)

_key = os.getenv("ENCRYPTION_KEY")
if not _key:
    # If not found, log a severe warning. The configurator shouldn't generate it, 
    # the main backend does. But if it's missing, encryption will fail.
    raise ValueError("ENCRYPTION_KEY not found in root .env. Please start the main backend first to generate it.")

fernet = Fernet(_key.encode('utf-8'))

def encrypt_secret(plain_text: str) -> str:
    """Encrypts a plain text secret."""
    if not plain_text:
        return plain_text
    return fernet.encrypt(plain_text.encode('utf-8')).decode('utf-8')

def decrypt_secret(encrypted_text: str) -> str:
    """Decrypts an encrypted secret."""
    if not encrypted_text:
        return encrypted_text
    try:
        return fernet.decrypt(encrypted_text.encode('utf-8')).decode('utf-8')
    except Exception:
        # If decryption fails (e.g. InvalidToken), assume the text is not encrypted
        return encrypted_text
