#!/bin/bash

###############################################################################
# PixelScript Ubuntu Deployment Verification Script
# This script verifies all components are properly configured for Ubuntu
###############################################################################

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}PixelScript Ubuntu Setup Verification${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0
WARNINGS=0

# Test function
test_component() {
    local name=$1
    local command=$2
    local required=$3
    
    echo -n "Checking $name... "
    
    if bash -c "$command" &>/dev/null; then
        echo -e "${GREEN}✓${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        if [ "$required" = "yes" ]; then
            echo -e "${RED}✗ (REQUIRED)${NC}"
            ((TESTS_FAILED++))
        else
            echo -e "${YELLOW}⚠ (Optional)${NC}"
            ((WARNINGS++))
        fi
        return 1
    fi
}

# Verify System Requirements
echo -e "${BLUE}1. System Requirements${NC}"
test_component "Node.js" "command -v node" "yes"
test_component "npm" "command -v npm" "yes"
test_component "Python 3" "command -v python3" "no"
test_component "Git" "command -v git" "yes"

echo ""

# Verify Project Setup
echo -e "${BLUE}2. Project Configuration${NC}"
test_component "package.json exists" "test -f package.json" "yes"
test_component "node_modules exists" "test -d node_modules" "yes"
test_component ".env file exists" "test -f .env" "yes"
test_component ".gitignore exists" "test -f .gitignore" "yes"

echo ""

# Verify Dependencies
echo -e "${BLUE}3. Core Dependencies${NC}"
test_component "Express.js" "npm list express" "yes"
test_component "Mongoose" "npm list mongoose" "yes"
test_component "Socket.IO" "npm list socket.io" "yes"
test_component "bcryptjs" "npm list bcryptjs" "yes"
test_component "JWT support" "npm list jsonwebtoken" "yes"

echo ""

# Check Database Connectivity
echo -e "${BLUE}4. Database & Services${NC}"

# MongoDB check
echo -n "Checking MongoDB connection... "
MONGO_URI=$(grep MONGO_URI .env | head -1 | cut -d= -f2-)
if [ -n "$MONGO_URI" ]; then
    echo -e "${GREEN}✓ (Configured: ${MONGO_URI:0:50}...)${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ (No MONGO_URI in .env)${NC}"
    ((TESTS_FAILED++))
fi

# Redis check (optional)
echo -n "Checking Redis (optional)... "
REDIS_URL=$(grep REDIS_URL .env | head -1 | cut -d= -f2-)
if [ -n "$REDIS_URL" ]; then
    if command -v redis-cli &>/dev/null; then
        if redis-cli ping &>/dev/null; then
            echo -e "${GREEN}✓ Connected${NC}"
            ((TESTS_PASSED++))
        else
            echo -e "${YELLOW}⚠ Configured but not running${NC}"
            ((WARNINGS++))
        fi
    else
        echo -e "${YELLOW}⚠ Configured but redis-cli not found${NC}"
        ((WARNINGS++))
    fi
else
    echo -e "${YELLOW}⚠ Not configured (optional)${NC}"
fi

echo ""

# Environment Variables
echo -e "${BLUE}5. Environment Variables${NC}"

check_env_var() {
    local var=$1
    echo -n "Checking $var... "
    if grep -q "^${var}=" .env; then
        VALUE=$(grep "^${var}=" .env | head -1 | cut -d= -f2- | cut -c1-40)
        if [ -z "$VALUE" ] || [ "$VALUE" = "your_" ] || [ "$VALUE" = "" ]; then
            echo -e "${YELLOW}⚠ (Set to placeholder/empty)${NC}"
            ((WARNINGS++))
        else
            echo -e "${GREEN}✓ (${VALUE}...)${NC}"
            ((TESTS_PASSED++))
        fi
    else
        echo -e "${RED}✗ (Missing)${NC}"
        ((TESTS_FAILED++))
    fi
}

check_env_var "PORT"
check_env_var "NODE_ENV"
check_env_var "JWT_SECRET"
check_env_var "SESSION_SECRET"
check_env_var "MONGO_URI"

echo ""

# Verify Scripts
echo -e "${BLUE}6. npm Scripts${NC}"
test_component "start script" "npm run --list | grep -q 'start'" "yes"
test_component "dev script" "npm run --list | grep -q 'dev'" "yes"
test_component "e2e scripts" "npm run --list | grep -q 'e2e'" "no"

echo ""

# File Permissions
echo -e "${BLUE}7. File Permissions${NC}"
test_component "uploads writable" "test -w uploads" "yes"
test_component "public writable" "test -w public" "yes"
test_component "server.js readable" "test -r server.js" "yes"

echo ""

# Check for Windows-specific issues
echo -e "${BLUE}8. Cross-platform Compatibility${NC}"
echo -n "Checking for Windows line endings (CRLF)... "
CRLF_FILES=$(find . -type f \( -name "*.js" -o -name "*.json" \) -not -path "./node_modules/*" -exec file {} \; 2>/dev/null | grep CRLF | wc -l)
if [ "$CRLF_FILES" -eq 0 ]; then
    echo -e "${GREEN}✓ (All files use Unix line endings)${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${YELLOW}⚠ ($CRLF_FILES files with CRLF detected)${NC}"
    ((WARNINGS++))
fi

test_component "No hardcoded Windows paths" "! grep -r 'C:\\\\' . --include='*.js' --exclude-dir=node_modules" "yes"
test_component "No Windows batch files" "! find . -name '*.bat' -not -path './node_modules/*'" "yes"

echo ""

# Display Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Verification Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Passed:  ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed:  ${RED}$TESTS_FAILED${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
echo ""

# Final verdict
if [ "$TESTS_FAILED" -eq 0 ]; then
    if [ "$WARNINGS" -eq 0 ]; then
        echo -e "${GREEN}✓ All checks passed! System is ready.${NC}"
        exit 0
    else
        echo -e "${YELLOW}⚠ Setup complete with warnings (see above).${NC}"
        exit 0
    fi
else
    echo -e "${RED}✗ Setup has $TESTS_FAILED critical issues.${NC}"
    echo -e "${RED}Please fix the issues above before proceeding.${NC}"
    exit 1
fi
