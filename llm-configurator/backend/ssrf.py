import socket
import ipaddress
from urllib.parse import urlparse

def validate_url(url: str, allow_local: bool = False):
    """
    Validates a URL against SSRF attacks.
    Resolves the hostname and checks the IP address.
    Raises ValueError if the URL is invalid or points to a forbidden IP.
    """
    try:
        parsed = urlparse(url)
    except Exception as e:
        raise ValueError(f"Invalid URL format: {str(e)}")

    if parsed.scheme not in ('http', 'https'):
        raise ValueError(f"Invalid URL scheme '{parsed.scheme}'. Only http and https are allowed.")
    
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL must contain a hostname.")

    try:
        # Resolve all IPs for the hostname
        # getaddrinfo returns a list of tuples: (family, type, proto, canonname, sockaddr)
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise ValueError(f"Could not resolve hostname: {hostname}")

    for info in addr_info:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        
        # ALWAYS block cloud metadata IP
        if ip == ipaddress.ip_address('169.254.169.254'):
            raise ValueError("Access to cloud metadata IP is forbidden.")
        
        # Block private, loopback, link-local unless allow_local is True
        if not allow_local:
            if ip.is_private or ip.is_loopback or ip.is_link_local:
                raise ValueError(f"Access to local/private IP ({ip}) is forbidden unless allow_local is true.")
    
    return True
