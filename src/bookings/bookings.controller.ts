import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BookingsService } from './bookings.service';
import { BookingResponseDto } from './dto/booking-response.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-status.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('shops/:shopId/bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @ApiOperation({ summary: 'Book a slot; the caller is the customer' })
  @ApiCreatedResponse({ type: BookingResponseDto })
  @ApiConflictResponse({
    description:
      'The slot was taken first. Two concurrent requests for the same slot get one of these.',
  })
  @ApiBadRequestResponse({ description: 'Closed day, outside opening hours, past, or off-grid' })
  @ApiNotFoundResponse({ description: 'Unknown shop, or service/staff not in this shop' })
  create(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBookingDto,
  ): Promise<BookingResponseDto> {
    return this.bookings.create(shopId, user.id, dto);
  }

  @Patch(':bookingId/status')
  @ApiOperation({
    summary: 'Advance a booking through the queue',
    description:
      'For the shop’s owner or its staff. Broadcasts the new queue to everyone watching ' +
      'this shop on the /queue websocket namespace.',
  })
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiBadRequestResponse({ description: 'Illegal transition for the booking’s current status' })
  @ApiNotFoundResponse({ description: 'Unknown booking, or the caller does not run this shop' })
  updateStatus(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateBookingStatusDto,
  ): Promise<BookingResponseDto> {
    return this.bookings.updateStatus(shopId, bookingId, dto.status, user);
  }
}

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class MyBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('me')
  @ApiOperation({ summary: "The caller's own bookings, newest first" })
  @ApiOkResponse({ type: [BookingResponseDto] })
  listMine(@CurrentUser() user: AuthenticatedUser): Promise<BookingResponseDto[]> {
    return this.bookings.listForCustomer(user.id);
  }

  @Get(':bookingId')
  @ApiOperation({ summary: 'One of the caller’s own bookings' })
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiNotFoundResponse({ description: 'No such booking, or it belongs to someone else' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ): Promise<BookingResponseDto> {
    return this.bookings.findOwnOrThrow(bookingId, user.id);
  }

  @Patch(':bookingId/cancel')
  @ApiOperation({ summary: 'Call off your own booking, freeing the slot' })
  @ApiOkResponse({ type: BookingResponseDto })
  @ApiBadRequestResponse({ description: 'The booking is already finished or cancelled' })
  @ApiNotFoundResponse({ description: 'No such booking, or it belongs to someone else' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ): Promise<BookingResponseDto> {
    return this.bookings.cancelOwn(bookingId, user.id);
  }
}
