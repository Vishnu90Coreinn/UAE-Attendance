using HrPayroll.Api.Auth;

namespace HrPayroll.Api.Tests.Unit;

public class PasswordPolicyTests
{
    private const string Username = "jane.doe";

    [Theory]
    [InlineData(10)]
    [InlineData(11)]
    [InlineData(64)]
    [InlineData(128)]
    public void Validate_AcceptsPasswordsOfTenToOneHundredTwentyEightCharacters(int length)
    {
        Assert.Null(PasswordPolicy.Validate(new string('a', length), Username));
    }

    [Fact]
    public void Validate_RejectsANineCharacterPassword_WithAMessageThatSaysWhy()
    {
        var error = PasswordPolicy.Validate(new string('a', 9), Username);

        Assert.Equal("Password must be at least 10 characters.", error);
    }

    [Theory]
    [InlineData("")]
    [InlineData("short")]
    public void Validate_RejectsShortAndEmptyPasswords(string password)
    {
        Assert.NotNull(PasswordPolicy.Validate(password, Username));
    }

    [Fact]
    public void Validate_RejectsAOneHundredTwentyNineCharacterPassword_WithAMessageThatSaysWhy()
    {
        var error = PasswordPolicy.Validate(new string('a', 129), Username);

        Assert.Equal("Password must be at most 128 characters.", error);
    }

    [Theory]
    [InlineData("JANE.DOE.JANE")]
    [InlineData("jane.doe.jane")]
    public void Validate_AcceptsAPasswordThatMerelyContainsTheUsername(string password)
    {
        // Only an exact match is forbidden; the length rule is satisfied here.
        Assert.Null(PasswordPolicy.Validate(password, "jane.doe"));
    }

    [Theory]
    [InlineData("administrator")]
    [InlineData("ADMINISTRATOR")]
    [InlineData("AdMiNiStRaToR")]
    public void Validate_RejectsAPasswordEqualToTheUsername_IgnoringCase(string password)
    {
        var error = PasswordPolicy.Validate(password, "Administrator");

        Assert.Equal("Password must not be the same as the username.", error);
    }

    [Fact]
    public void Validate_AcceptsANormalPassword()
    {
        Assert.Null(PasswordPolicy.Validate("Correct-Horse-Battery-1", Username));
    }

    [Fact]
    public void Validate_ChecksLengthBeforeTheUsername()
    {
        // "bob" equals the username but is also too short; the length message is the more useful one.
        Assert.Equal("Password must be at least 10 characters.", PasswordPolicy.Validate("bob", "bob"));
    }
}
